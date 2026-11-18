use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

pub const MAX_SCHEDULE_BYTES: u64 = 5 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SchedulePayload {
    pub path: String,
    pub io_status: String,
    pub message: Option<String>,
    pub contents: Option<String>,
    pub mtime_ms: Option<u64>,
}

pub fn schedule_path_in_home(home: &Path) -> PathBuf {
    home.join("secretary").join("schedule.csv")
}

pub fn event_targets_schedule(paths: &[PathBuf], schedule: &Path) -> bool {
    let Some(name) = schedule.file_name() else {
        return false;
    };
    if name.is_empty() {
        return false;
    }
    let parent = schedule.parent().unwrap_or(Path::new(""));
    paths.iter().any(|path| {
        path.file_name() == Some(name)
            && match path.parent() {
                Some(event_parent) if event_parent.as_os_str().is_empty() => true,
                Some(event_parent) => event_parent == parent,
                None => false,
            }
    })
}

pub fn decode_schedule_bytes(bytes: &[u8]) -> Result<String, String> {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return String::from_utf8(bytes[3..].to_vec()).map_err(|_| "UTF-8として読めません".into());
    }
    if bytes.starts_with(&[0xFF, 0xFE]) {
        return decode_utf16(&bytes[2..], true);
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        return decode_utf16(&bytes[2..], false);
    }
    String::from_utf8(bytes.to_vec()).map_err(|_| "UTF-8として読めません".into())
}

fn decode_utf16(bytes: &[u8], little_endian: bool) -> Result<String, String> {
    if bytes.len() % 2 != 0 {
        return Err("UTF-16として読めません".into());
    }
    let units = bytes
        .chunks_exact(2)
        .map(|chunk| {
            if little_endian {
                u16::from_le_bytes([chunk[0], chunk[1]])
            } else {
                u16::from_be_bytes([chunk[0], chunk[1]])
            }
        })
        .collect::<Vec<_>>();
    String::from_utf16(&units).map_err(|_| "UTF-16として読めません".into())
}

pub fn read_schedule_at(path: &Path) -> SchedulePayload {
    let display = path.to_string_lossy().into_owned();
    if !path.exists() {
        return SchedulePayload {
            path: display,
            io_status: "missing".into(),
            message: Some("予定ファイルが見つかりません".into()),
            contents: None,
            mtime_ms: None,
        };
    }
    if !path.is_file() {
        return SchedulePayload {
            path: display,
            io_status: "notAFile".into(),
            message: Some("指定されたパスはファイルではありません".into()),
            contents: None,
            mtime_ms: None,
        };
    }
    let meta = match std::fs::metadata(path) {
        Ok(meta) => meta,
        Err(err) => return unreadable(display, err.to_string()),
    };
    if meta.len() > MAX_SCHEDULE_BYTES {
        return unreadable(display, "ファイルが大きすぎます（5MBまで）".into());
    }
    match std::fs::read(path) {
        Ok(bytes) => match decode_schedule_bytes(&bytes) {
            Ok(text) => SchedulePayload {
                path: display,
                io_status: "ok".into(),
                message: None,
                contents: Some(text),
                mtime_ms: mtime_ms(&meta),
            },
            Err(message) => unreadable(display, message),
        },
        Err(err) => unreadable(display, err.to_string()),
    }
}

fn unreadable(path: String, message: String) -> SchedulePayload {
    SchedulePayload {
        path,
        io_status: "unreadable".into(),
        message: Some(message),
        contents: None,
        mtime_ms: None,
    }
}

fn mtime_ms(meta: &std::fs::Metadata) -> Option<u64> {
    meta.modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_millis()
        .try_into()
        .ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_only_the_watched_file_name_in_that_directory() {
        let schedule = PathBuf::from("home")
            .join("ada")
            .join("secretary")
            .join("schedule.csv");
        assert!(event_targets_schedule(&[schedule.clone()], &schedule));
        assert!(event_targets_schedule(
            &[PathBuf::from("schedule.csv")],
            &schedule
        ));
        assert!(!event_targets_schedule(
            &[PathBuf::from("home")
                .join("ada")
                .join("other")
                .join("schedule.csv")],
            &schedule
        ));
        assert!(!event_targets_schedule(
            &[schedule.parent().unwrap().to_path_buf()],
            &schedule
        ));
    }

    #[test]
    fn decodes_utf8_with_and_without_bom_and_utf16() {
        assert_eq!(decode_schedule_bytes(b"\xEF\xBB\xBFname").unwrap(), "name");
        assert_eq!(decode_schedule_bytes("名前".as_bytes()).unwrap(), "名前");
        let mut utf16 = vec![0xFF, 0xFE];
        utf16.extend("予定".encode_utf16().flat_map(|unit| unit.to_le_bytes()));
        assert_eq!(decode_schedule_bytes(&utf16).unwrap(), "予定");
        assert!(decode_schedule_bytes(&[0xFF, 0x00]).is_err());
    }

    #[test]
    fn reads_missing_directory_and_text() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("schedule.csv");
        assert_eq!(read_schedule_at(&missing).io_status, "missing");
        assert_eq!(read_schedule_at(dir.path()).io_status, "notAFile");

        let file = dir.path().join("schedule.csv");
        std::fs::write(&file, b"\xEF\xBB\xBF\xe5\x90\x8d\xe5\x89\x8d").unwrap();
        let payload = read_schedule_at(&file);
        assert_eq!(payload.io_status, "ok");
        assert_eq!(payload.contents.as_deref(), Some("名前"));
        assert!(payload.mtime_ms.is_some());

        std::fs::write(dir.path().join("bad.csv"), [0xFF, 0x00]).unwrap();
        assert_eq!(
            read_schedule_at(&dir.path().join("bad.csv")).io_status,
            "unreadable"
        );
    }

    #[test]
    fn sample_csv_starts_with_a_utf8_bom() {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../samples/notion-ja.csv");
        let bytes = std::fs::read(path).unwrap();
        assert!(bytes.starts_with(&[0xEF, 0xBB, 0xBF]));
        let text = decode_schedule_bytes(&bytes).unwrap();
        assert!(text.starts_with("名前"));
    }
}
