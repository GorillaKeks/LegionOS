use std::str::FromStr;
use tauri_plugin_global_shortcut::Shortcut;

#[derive(Clone, Debug)]
pub enum HotkeyBinding {
    RightControl,
    Shortcut(Shortcut),
}

impl HotkeyBinding {
    pub fn canonical(&self) -> String {
        match self {
            Self::RightControl => "RightCtrl".into(),
            Self::Shortcut(shortcut) => shortcut.to_string(),
        }
    }
}

pub fn parse_shortcut(value: &str) -> Result<HotkeyBinding, String> {
    let value = value.trim();
    if ["rightctrl", "rcontrol", "rightcontrol", "controlright"]
        .iter()
        .any(|alias| value.eq_ignore_ascii_case(alias))
    {
        return Ok(HotkeyBinding::RightControl);
    }
    let shortcut = Shortcut::from_str(value)
        .map_err(|error| format!("Ungültige Tastenkombination: {error}"))?;
    Ok(HotkeyBinding::Shortcut(shortcut))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_right_control_aliases() {
        for alias in ["RightCtrl", "RControl", "RightControl", "ControlRight"] {
            assert_eq!(parse_shortcut(alias).unwrap().canonical(), "RightCtrl");
        }
    }

    #[test]
    fn accepts_modified_shortcuts_and_canonicalizes_them() {
        assert_eq!(
            parse_shortcut("CTRL + SHIFT + SPACE").unwrap().canonical(),
            "shift+control+Space"
        );
    }

    #[test]
    fn accepts_tab_as_the_global_bare_key() {
        let HotkeyBinding::Shortcut(shortcut) = parse_shortcut("TAB").unwrap() else {
            panic!("Tab must use the global shortcut backend");
        };
        assert!(shortcut.mods.is_empty());
        assert_eq!(shortcut.to_string(), "Tab");
    }

    #[test]
    fn accepts_single_keys_and_rejects_malformed_hotkeys() {
        let HotkeyBinding::Shortcut(letter) = parse_shortcut("A").unwrap() else {
            panic!("a single letter must be accepted by the global shortcut API");
        };
        assert!(letter.mods.is_empty());
        assert_eq!(letter.to_string(), "KeyA");
        let HotkeyBinding::Shortcut(function_key) = parse_shortcut("F8").unwrap() else {
            panic!("a single function key must be accepted by the global shortcut API");
        };
        assert!(function_key.mods.is_empty());
        assert!(parse_shortcut("ctrl++space").is_err());
        assert!(parse_shortcut("ctrl+shift+unknown-key").is_err());
    }
}
