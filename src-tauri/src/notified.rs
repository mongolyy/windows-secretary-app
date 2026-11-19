use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// すでに知らせた予定。CSV の再読み込みやアプリの再起動をまたいで残す。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FiredNotice {
    pub key: String,
    pub start_ms: i64,
}

const MAX_RECORDS: usize = 200;
const MAX_KEY_CHARS: usize = 500;

pub fn load_notified() -> Vec<FiredNotice> {
    let Some(path) = notified_file_path() else {
        return Vec::new();
    };
    load_from(&path)
}

pub fn save_notified(records: &[FiredNotice]) -> Result<(), String> {
    let path = notified_file_path().ok_or("通知の記録を保存する場所を決められません")?;
    save_to(&path, records)
}

pub fn notified_file_path() -> Option<PathBuf> {
    dirs::config_dir().map(|dir| dir.join("secretary").join("notified.json"))
}

fn load_from(path: &Path) -> Vec<FiredNotice> {
    let Ok(text) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    parse_notified(&text)
}

fn save_to(path: &Path, records: &[FiredNotice]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let clean = sanitize(records.to_vec());
    let text = serde_json::to_string_pretty(&clean).map_err(|err| err.to_string())?;
    std::fs::write(path, text).map_err(|err| err.to_string())
}

fn parse_notified(text: &str) -> Vec<FiredNotice> {
    match serde_json::from_str::<Vec<FiredNotice>>(text) {
        Ok(records) => sanitize(records),
        Err(_) => Vec::new(),
    }
}

/// 画面から渡された記録を、空のキーや重複を除いて上限までに収める。
fn sanitize(records: Vec<FiredNotice>) -> Vec<FiredNotice> {
    let mut seen = std::collections::HashSet::new();
    let mut clean = Vec::new();
    for record in records {
        let key = record.key.trim().to_string();
        if key.is_empty() || key.chars().count() > MAX_KEY_CHARS {
            continue;
        }
        if !seen.insert(key.clone()) {
            continue;
        }
        clean.push(FiredNotice {
            key,
            start_ms: record.start_ms,
        });
        if clean.len() == MAX_RECORDS {
            break;
        }
    }
    clean
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn corrupt_json_is_an_empty_log() {
        assert!(parse_notified("").is_empty());
        assert!(parse_notified("{").is_empty());
        assert!(parse_notified("null").is_empty());
    }

    #[test]
    fn drops_blank_keys_and_duplicates() {
        let clean = sanitize(vec![
            FiredNotice {
                key: "  ".into(),
                start_ms: 1,
            },
            FiredNotice {
                key: " a ".into(),
                start_ms: 2,
            },
            FiredNotice {
                key: "a".into(),
                start_ms: 3,
            },
            FiredNotice {
                key: "b".into(),
                start_ms: 4,
            },
        ]);
        assert_eq!(
            clean,
            vec![
                FiredNotice {
                    key: "a".into(),
                    start_ms: 2,
                },
                FiredNotice {
                    key: "b".into(),
                    start_ms: 4,
                },
            ]
        );
    }

    #[test]
    fn round_trips_through_a_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("notified.json");
        let records = vec![FiredNotice {
            key: "100\u{0}定例".into(),
            start_ms: 100,
        }];
        save_to(&path, &records).unwrap();
        assert_eq!(load_from(&path), records);
    }
}
