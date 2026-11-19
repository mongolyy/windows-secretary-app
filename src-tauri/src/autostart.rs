use std::path::Path;

/// ログイン時の起動では、ウィンドウを出さずトレイにしまう。
pub const TRAY_ARG: &str = "--minimized";

/// 現在のユーザーの Run キーに書く名前。全ユーザー向けの登録はしない。
#[cfg_attr(not(windows), allow(dead_code))]
const RUN_VALUE_NAME: &str = "Secretary";
#[cfg_attr(not(windows), allow(dead_code))]
const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
#[cfg_attr(not(windows), allow(dead_code))]
const STARTUP_APPROVED_KEY: &str =
    r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";

/// タスク マネージャーの「スタートアップ」で有効を表す値。末尾 8 バイトが 0 以外だと無効になる。
#[cfg_attr(not(windows), allow(dead_code))]
const STARTUP_APPROVED_ENABLED: [u8; 12] = [
    0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
];

pub fn launched_in_tray(args: &[String]) -> bool {
    args.iter().any(|arg| arg == TRAY_ARG)
}

/// Run キーへ書くコマンド。空白を含むパスでも割れないよう、実行ファイルは引用符で囲む。
#[cfg_attr(not(windows), allow(dead_code))]
pub fn login_command(exe: &Path) -> Result<String, String> {
    let text = exe.display().to_string();
    if text.is_empty() || text.contains(['"', '\n', '\r']) {
        return Err("実行ファイルのパスを自動起動に使えません".into());
    }
    Ok(format!("\"{text}\" {TRAY_ARG}"))
}

pub fn apply_launch_at_login(enabled: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        apply_windows(enabled)
    }
    #[cfg(not(windows))]
    {
        // ログイン項目の書き換えは Windows だけで行う。設定値自体は保存する。
        let _ = enabled;
        Ok(())
    }
}

#[cfg(windows)]
fn apply_windows(enabled: bool) -> Result<(), String> {
    use winreg::enums::{RegType, HKEY_CURRENT_USER};
    use winreg::{RegKey, RegValue};

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (run_key, _) = hkcu
        .create_subkey(RUN_KEY)
        .map_err(|err| format!("自動起動の設定を開けません: {err}"))?;

    if enabled {
        let exe = std::env::current_exe()
            .map_err(|err| format!("実行ファイルの場所がわかりません: {err}"))?;
        let command = login_command(&exe)?;
        run_key
            .set_value(RUN_VALUE_NAME, &command)
            .map_err(|err| format!("自動起動を有効にできません: {err}"))?;
        // タスク マネージャーで無効にされていたら、設定をオンにした時点で戻す。
        // このキーが無い環境では、Run の値だけでログイン時に起動する。
        if let Ok((approved, _)) = hkcu.create_subkey(STARTUP_APPROVED_KEY) {
            let _ = approved.set_raw_value(
                RUN_VALUE_NAME,
                &RegValue {
                    bytes: STARTUP_APPROVED_ENABLED.as_slice().into(),
                    vtype: RegType::REG_BINARY,
                },
            );
        }
        Ok(())
    } else {
        match run_key.delete_value(RUN_VALUE_NAME) {
            Ok(()) => {}
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
            Err(err) => return Err(format!("自動起動を無効にできません: {err}")),
        }
        if let Ok(approved) =
            hkcu.open_subkey_with_flags(STARTUP_APPROVED_KEY, winreg::enums::KEY_SET_VALUE)
        {
            let _ = approved.delete_value(RUN_VALUE_NAME);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quotes_a_path_that_contains_spaces() {
        let command =
            login_command(Path::new(r"C:\Program Files\Secretary\secretary.exe")).unwrap();
        assert_eq!(
            command,
            r#""C:\Program Files\Secretary\secretary.exe" --minimized"#
        );
    }

    #[test]
    fn rejects_a_quote_in_the_path() {
        let path = Path::new("C:\\bad\"path\\secretary.exe");
        assert!(login_command(path).is_err());
    }

    #[test]
    fn tray_flag_matches_only_the_login_argument() {
        assert!(launched_in_tray(&[
            r"C:\Secretary\secretary.exe".into(),
            "--minimized".into()
        ]));
        assert!(!launched_in_tray(&[
            r"C:\Secretary\secretary.exe".into(),
            "--minimized-extra".into()
        ]));
        assert!(!launched_in_tray(&[r"C:\Secretary\secretary.exe".into()]));
    }
}
