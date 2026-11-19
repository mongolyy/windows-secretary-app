use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::files::schedule_path_in_home;

fn default_true() -> bool {
    true
}

fn default_tz() -> String {
    "Asia/Tokyo".into()
}

fn default_threshold() -> u32 {
    1440
}

fn default_false() -> bool {
    false
}

fn default_notify_enabled() -> bool {
    true
}

fn default_lead_minutes() -> u32 {
    5
}

fn default_schedule_path_string() -> String {
    default_schedule_path().to_string_lossy().into_owned()
}

fn default_columns() -> ColumnMapping {
    ColumnMapping::default()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct ColumnMapping {
    pub title: String,
    pub date: String,
    pub end: String,
    pub location: String,
    pub url: String,
}

impl Default for ColumnMapping {
    fn default() -> Self {
        Self {
            title: "名前".into(),
            date: "日付".into(),
            end: String::new(),
            location: "場所".into(),
            url: "URL".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(default = "default_schedule_path_string")]
    pub schedule_path: String,
    #[serde(default = "default_true")]
    pub auto_detect_columns: bool,
    #[serde(default = "default_columns")]
    pub columns: ColumnMapping,
    #[serde(default = "default_tz")]
    pub time_zone: String,
    #[serde(default = "default_threshold")]
    pub stale_threshold_minutes: u32,
    #[serde(default = "default_true")]
    pub always_on_top: bool,
    #[serde(default = "default_true")]
    pub close_to_tray: bool,
    /// Windows へのログイン時に、ウィンドウを出さずトレイへ起動する。
    #[serde(default = "default_false")]
    pub launch_at_login: bool,
    /// 次の時刻指定の予定が始まる前に、デスクトップ通知を出す。
    #[serde(default = "default_notify_enabled")]
    pub notify_enabled: bool,
    /// 開始の何分前に知らせるか。1 から 180。
    #[serde(default = "default_lead_minutes")]
    pub notify_lead_minutes: u32,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            schedule_path: default_schedule_path_string(),
            auto_detect_columns: true,
            columns: ColumnMapping::default(),
            time_zone: default_tz(),
            stale_threshold_minutes: default_threshold(),
            always_on_top: true,
            close_to_tray: true,
            launch_at_login: false,
            notify_enabled: true,
            notify_lead_minutes: default_lead_minutes(),
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SettingsDto {
    pub schedule_path: String,
    pub auto_detect_columns: bool,
    pub columns: ColumnMapping,
    pub time_zone: String,
    pub stale_threshold_minutes: u32,
    pub always_on_top: bool,
    pub close_to_tray: bool,
    pub launch_at_login: bool,
    pub notify_enabled: bool,
    pub notify_lead_minutes: u32,
    pub effective_schedule_path: String,
    pub path_overridden_by_env: bool,
}

pub fn default_schedule_path() -> PathBuf {
    dirs::home_dir()
        .map(|home| schedule_path_in_home(&home))
        .unwrap_or_else(|| PathBuf::from("secretary").join("schedule.csv"))
}

pub fn expand_user_path(raw: &str, home: Option<&Path>) -> PathBuf {
    let trimmed = raw.trim();
    if let Some(home) = home {
        let home_text = home.to_string_lossy();
        let mut expanded = trimmed.to_string();
        for token in ["%USERPROFILE%", "%userprofile%"] {
            if expanded.contains(token) {
                expanded = expanded.replace(token, home_text.as_ref());
            }
        }
        if expanded == "~" {
            return home.to_path_buf();
        }
        if let Some(rest) = expanded
            .strip_prefix("~/")
            .or_else(|| expanded.strip_prefix("~\\"))
        {
            return home.join(rest);
        }
        return PathBuf::from(expanded);
    }
    PathBuf::from(trimmed)
}

pub fn resolve_schedule_path(
    configured: &str,
    env_override: Option<&str>,
    home: Option<&Path>,
) -> (PathBuf, bool) {
    if let Some(value) = env_override {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return (expand_user_path(trimmed, home), true);
        }
    }
    (expand_user_path(configured, home), false)
}

impl Settings {
    pub fn to_dto(&self) -> SettingsDto {
        let env = std::env::var("SECRETARY_SCHEDULE_PATH").ok();
        let (path, overridden) = resolve_schedule_path(
            &self.schedule_path,
            env.as_deref(),
            dirs::home_dir().as_deref(),
        );
        SettingsDto {
            schedule_path: self.schedule_path.clone(),
            auto_detect_columns: self.auto_detect_columns,
            columns: self.columns.clone(),
            time_zone: self.time_zone.clone(),
            stale_threshold_minutes: self.stale_threshold_minutes,
            always_on_top: self.always_on_top,
            close_to_tray: self.close_to_tray,
            launch_at_login: self.launch_at_login,
            notify_enabled: self.notify_enabled,
            notify_lead_minutes: self.notify_lead_minutes,
            effective_schedule_path: path.to_string_lossy().into_owned(),
            path_overridden_by_env: overridden,
        }
    }

    pub fn effective_path(&self) -> PathBuf {
        PathBuf::from(&self.to_dto().effective_schedule_path)
    }
}

pub fn validate(input: Settings) -> Result<Settings, String> {
    let schedule_path = input.schedule_path.trim().to_string();
    if schedule_path.is_empty() {
        return Err("予定ファイルのパスを入力してください".into());
    }
    if schedule_path.chars().count() > 4096 || schedule_path.contains(['\n', '\r']) {
        return Err("予定ファイルのパスが不正です".into());
    }
    if !(5..=20_160).contains(&input.stale_threshold_minutes) {
        return Err("古さのしきい値は 5 分から 20160 分にしてください".into());
    }
    let time_zone = input.time_zone.trim().to_string();
    if !valid_tz_name(&time_zone) {
        return Err("タイムゾーンの名前が不正です".into());
    }
    if !(1..=180).contains(&input.notify_lead_minutes) {
        return Err("通知は 1 分前から 180 分前にしてください".into());
    }
    Ok(Settings {
        schedule_path,
        auto_detect_columns: input.auto_detect_columns,
        columns: ColumnMapping {
            title: clean_column(&input.columns.title)?,
            date: clean_column(&input.columns.date)?,
            end: clean_column(&input.columns.end)?,
            location: clean_column(&input.columns.location)?,
            url: clean_column(&input.columns.url)?,
        },
        time_zone,
        stale_threshold_minutes: input.stale_threshold_minutes,
        always_on_top: input.always_on_top,
        close_to_tray: input.close_to_tray,
        launch_at_login: input.launch_at_login,
        notify_enabled: input.notify_enabled,
        notify_lead_minutes: input.notify_lead_minutes,
    })
}

fn clean_column(value: &str) -> Result<String, String> {
    let trimmed = value.trim().to_string();
    if trimmed.chars().count() > 200 {
        return Err("列名が長すぎます".into());
    }
    if trimmed.contains(['\n', '\r']) {
        return Err("列名に改行は使えません".into());
    }
    Ok(trimmed)
}

fn valid_tz_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && !value.starts_with('/')
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '/' | '_' | '-' | '+'))
}

pub fn settings_file_path() -> Option<PathBuf> {
    dirs::config_dir().map(|dir| dir.join("secretary").join("settings.json"))
}

pub fn load_settings() -> Settings {
    let Some(path) = settings_file_path() else {
        return Settings::default();
    };
    let Ok(text) = std::fs::read_to_string(path) else {
        return Settings::default();
    };
    match serde_json::from_str::<Settings>(&text) {
        Ok(settings) => validate(settings).unwrap_or_else(|_| Settings::default()),
        Err(_) => Settings::default(),
    }
}

pub fn save_settings(settings: &Settings) -> Result<(), String> {
    let path = settings_file_path().ok_or("設定を保存する場所を決められません")?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let text = serde_json::to_string_pretty(settings).map_err(|err| err.to_string())?;
    std::fs::write(path, text).map_err(|err| err.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_schedule_lives_under_secretary() {
        let home = Path::new("Users").join("ada");
        assert_eq!(
            schedule_path_in_home(&home),
            home.join("secretary").join("schedule.csv")
        );
    }

    #[test]
    fn expands_home_and_userprofile() {
        let home = Path::new("home").join("ada");
        assert_eq!(
            expand_user_path("~/secretary/schedule.csv", Some(&home)),
            home.join("secretary").join("schedule.csv")
        );
        assert_eq!(
            expand_user_path("%USERPROFILE%/secretary/schedule.csv", Some(&home)),
            PathBuf::from(format!("{}/secretary/schedule.csv", home.to_string_lossy()))
        );
        let windows = expand_user_path("~\\secretary\\schedule.csv", Some(&home));
        assert!(windows.starts_with(&home));
    }

    #[test]
    fn env_override_wins() {
        let home = Path::new("/home/ada");
        let (path, overridden) = resolve_schedule_path(
            "/tmp/configured.csv",
            Some("~/secretary/from-env.csv"),
            Some(home),
        );
        assert!(overridden);
        assert_eq!(path, home.join("secretary").join("from-env.csv"));
    }

    #[test]
    fn rejects_a_short_stale_threshold() {
        let settings = Settings {
            stale_threshold_minutes: 1,
            ..Default::default()
        };
        assert!(validate(settings).is_err());
    }

    #[test]
    fn default_zone_is_tokyo_and_threshold_is_one_day() {
        let settings = Settings::default();
        assert_eq!(settings.time_zone, "Asia/Tokyo");
        assert_eq!(settings.stale_threshold_minutes, 1440);
        assert!(settings.auto_detect_columns);
        assert!(settings.always_on_top);
        assert!(!settings.launch_at_login);
        assert!(settings.notify_enabled);
        assert_eq!(settings.notify_lead_minutes, 5);
    }

    #[test]
    fn older_settings_file_keeps_login_and_notify_defaults() {
        let parsed: Settings = serde_json::from_str("{}").unwrap();
        let settings = validate(parsed).unwrap();
        assert!(!settings.launch_at_login);
        assert!(settings.notify_enabled);
        assert_eq!(settings.notify_lead_minutes, 5);
    }

    #[test]
    fn rejects_a_notify_lead_outside_the_range() {
        let too_short = Settings {
            notify_lead_minutes: 0,
            ..Default::default()
        };
        assert!(validate(too_short).is_err());
        let too_long = Settings {
            notify_lead_minutes: 181,
            ..Default::default()
        };
        assert!(validate(too_long).is_err());
    }
}
