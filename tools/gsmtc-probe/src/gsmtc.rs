use windows::{
    Media::Control::{
        GlobalSystemMediaTransportControlsSession, GlobalSystemMediaTransportControlsSessionManager,
    },
    Storage::Streams::DataReader,
    Win32::System::WinRT::{RO_INIT_MULTITHREADED, RoInitialize, RoUninitialize},
    Win32::{
        Foundation::{APPMODEL_ERROR_NO_PACKAGE, ERROR_INSUFFICIENT_BUFFER, WIN32_ERROR},
        Storage::Packaging::Appx::GetCurrentPackageFullName,
    },
    core::{HRESULT, PWSTR},
};

const MAX_ARTWORK_BYTES: u64 = 10 * 1024 * 1024;

type GsmtcResult<T> = Result<T, windows::core::Error>;

struct WinRtApartment;

impl WinRtApartment {
    fn initialize() -> GsmtcResult<Self> {
        unsafe { RoInitialize(RO_INIT_MULTITHREADED)? };
        Ok(Self)
    }
}

impl Drop for WinRtApartment {
    fn drop(&mut self) {
        unsafe { RoUninitialize() };
    }
}

fn is_spotify_aumid(aumid: &str) -> bool {
    let aumid = aumid.to_ascii_lowercase();
    aumid == "spotify" || aumid == "spotify.exe" || aumid.starts_with("spotifyab.spotifymusic_")
}

pub fn run() -> Result<(), String> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    if args.iter().any(|arg| arg == "--help" || arg == "-h") {
        println!("Usage: legionos-gsmtc-poc [--play-pause | --next | --previous]");
        println!("Without a command, the tool only inspects the Spotify session.");
        return Ok(());
    }
    run_with_args(args)
        .map_err(|error| format!("{error} (HRESULT 0x{:08X})", error.code().0 as u32))
}

fn run_with_args(args: impl IntoIterator<Item = String>) -> GsmtcResult<()> {
    let command = parse_command(args)?;
    match current_package_identity()? {
        Some(identity) => println!("Package identity: {identity}"),
        None => println!("Package identity: none (unpackaged desktop process)"),
    }
    let _apartment = WinRtApartment::initialize()?;
    let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()?.join()?;
    let sessions = manager.GetSessions()?;

    println!("Available GSMTC sessions: {}", sessions.Size()?);
    let mut spotify_session: Option<GlobalSystemMediaTransportControlsSession> = None;

    for index in 0..sessions.Size()? {
        let session = sessions.GetAt(index)?;
        let aumid = session.SourceAppUserModelId()?.to_string();
        println!("- {aumid}");
        if spotify_session.is_none() && is_spotify_aumid(&aumid) {
            spotify_session = Some(session);
        }
    }

    let Some(session) = spotify_session else {
        println!(
            "Spotify GSMTC session: unavailable (Spotify is not exposing a matching session)."
        );
        return Ok(());
    };

    if let Some(command) = command {
        control_spotify_session(&session, command)
    } else {
        inspect_spotify_session(&session)
    }
}

fn current_package_identity() -> GsmtcResult<Option<String>> {
    let mut length = 0;
    let status = unsafe { GetCurrentPackageFullName(&mut length, None) };
    if status == APPMODEL_ERROR_NO_PACKAGE {
        return Ok(None);
    }
    if status != ERROR_INSUFFICIENT_BUFFER {
        return Err(windows::core::Error::from_hresult(HRESULT(status.0 as i32)));
    }

    let mut value = vec![0u16; length as usize];
    let status = unsafe { GetCurrentPackageFullName(&mut length, Some(PWSTR(value.as_mut_ptr()))) };
    if status != WIN32_ERROR(0) {
        return Err(windows::core::Error::from_hresult(HRESULT(status.0 as i32)));
    }
    let end = value
        .iter()
        .position(|character| *character == 0)
        .unwrap_or(value.len());
    Ok(Some(String::from_utf16_lossy(&value[..end])))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PlaybackCommand {
    PlayPause,
    Next,
    Previous,
}

fn parse_command(args: impl IntoIterator<Item = String>) -> GsmtcResult<Option<PlaybackCommand>> {
    let mut command = None;
    for arg in args {
        let parsed = match arg.as_str() {
            "--play-pause" => PlaybackCommand::PlayPause,
            "--next" => PlaybackCommand::Next,
            "--previous" => PlaybackCommand::Previous,
            _ => {
                return Err(windows::core::Error::new(
                    windows::core::HRESULT(0x80070057_u32 as i32),
                    "Unknown command-line option",
                ));
            }
        };
        if command.replace(parsed).is_some() {
            return Err(windows::core::Error::new(
                windows::core::HRESULT(0x80070057_u32 as i32),
                "Specify only one playback command",
            ));
        }
    }
    Ok(command)
}

fn inspect_spotify_session(session: &GlobalSystemMediaTransportControlsSession) -> GsmtcResult<()> {
    let properties = session.TryGetMediaPropertiesAsync()?.join()?;
    let playback = session.GetPlaybackInfo()?;
    let controls = playback.Controls()?;

    println!("Spotify session:");
    print_field("Title", &properties.Title()?.to_string());
    print_field("Artist", &properties.Artist()?.to_string());
    print_field("Album", &properties.AlbumTitle()?.to_string());
    println!("  Playback state: {:?}", playback.PlaybackStatus()?);
    println!(
        "  Play/Pause supported: {}",
        controls.IsPlayPauseToggleEnabled()?
    );
    println!("  Next supported: {}", controls.IsNextEnabled()?);
    println!("  Previous supported: {}", controls.IsPreviousEnabled()?);
    inspect_artwork(&properties);

    println!("No playback command was sent; this feasibility run only inspects support.");
    Ok(())
}

fn control_spotify_session(
    session: &GlobalSystemMediaTransportControlsSession,
    command: PlaybackCommand,
) -> GsmtcResult<()> {
    let controls = session.GetPlaybackInfo()?.Controls()?;
    let supported = is_command_supported(
        command,
        controls.IsPlayPauseToggleEnabled()?,
        controls.IsNextEnabled()?,
        controls.IsPreviousEnabled()?,
    );
    if !supported {
        println!("Spotify does not currently advertise support for {command:?}; no command sent.");
        return Ok(());
    }

    let accepted = match command {
        PlaybackCommand::PlayPause => session.TryTogglePlayPauseAsync()?.join()?,
        PlaybackCommand::Next => session.TrySkipNextAsync()?.join()?,
        PlaybackCommand::Previous => session.TrySkipPreviousAsync()?.join()?,
    };
    println!(
        "Spotify command {command:?}: {}",
        if accepted { "accepted" } else { "rejected" }
    );
    Ok(())
}

fn is_command_supported(
    command: PlaybackCommand,
    play_pause: bool,
    next: bool,
    previous: bool,
) -> bool {
    match command {
        PlaybackCommand::PlayPause => play_pause,
        PlaybackCommand::Next => next,
        PlaybackCommand::Previous => previous,
    }
}

fn print_field(label: &str, value: &str) {
    if value.trim().is_empty() {
        println!("  {label}: <unavailable>");
    } else {
        println!("  {label}: {value}");
    }
}

fn inspect_artwork(
    properties: &windows::Media::Control::GlobalSystemMediaTransportControlsSessionMediaProperties,
) {
    match read_artwork(properties) {
        Ok(ArtworkResult::Empty(content_type)) => {
            println!("  Artwork: empty stream ({content_type})")
        }
        Ok(ArtworkResult::Read(content_type, size)) => {
            println!("  Artwork: read successfully ({content_type}, {size} bytes)")
        }
        Ok(ArtworkResult::Skipped(content_type, size)) => println!(
            "  Artwork: available ({content_type}, {size} bytes; skipped above the 10 MiB safety limit)"
        ),
        Ok(ArtworkResult::Unavailable) => println!("  Artwork: unavailable"),
        Err(error) => println!("  Artwork: present but could not be read ({error})"),
    }
}

enum ArtworkResult {
    Unavailable,
    Empty(String),
    Read(String, usize),
    Skipped(String, u64),
}

fn read_artwork(
    properties: &windows::Media::Control::GlobalSystemMediaTransportControlsSessionMediaProperties,
) -> GsmtcResult<ArtworkResult> {
    let Ok(thumbnail) = properties.Thumbnail() else {
        return Ok(ArtworkResult::Unavailable);
    };
    let stream = thumbnail.OpenReadAsync()?.join()?;
    let size = stream.Size()?;
    let content_type = stream.ContentType()?.to_string();
    if size == 0 {
        return Ok(ArtworkResult::Empty(content_type));
    }
    if size > MAX_ARTWORK_BYTES {
        return Ok(ArtworkResult::Skipped(content_type, size));
    }

    let reader = DataReader::CreateDataReader(&stream.GetInputStreamAt(0)?)?;
    reader.LoadAsync(size as u32)?.join()?;
    let mut bytes = vec![0; size as usize];
    reader.ReadBytes(&mut bytes)?;
    reader.Close()?;
    Ok(ArtworkResult::Read(content_type, bytes.len()))
}

#[cfg(test)]
mod tests {
    use super::is_spotify_aumid;
    use super::{PlaybackCommand, is_command_supported, parse_command};

    #[test]
    fn matches_spotify_sessions_case_insensitively() {
        assert!(is_spotify_aumid("Spotify.exe"));
        assert!(is_spotify_aumid(
            "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify"
        ));
        assert!(!is_spotify_aumid("example.spotifyLyrics.Player"));
    }

    #[test]
    fn does_not_select_an_unrelated_media_session() {
        assert!(!is_spotify_aumid(
            "Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic"
        ));
        assert!(!is_spotify_aumid(""));
    }

    #[test]
    fn parses_each_explicit_playback_command() {
        assert_eq!(
            parse_command(["--play-pause".to_owned()]).unwrap(),
            Some(PlaybackCommand::PlayPause)
        );
        assert_eq!(
            parse_command(["--next".to_owned()]).unwrap(),
            Some(PlaybackCommand::Next)
        );
        assert_eq!(
            parse_command(["--previous".to_owned()]).unwrap(),
            Some(PlaybackCommand::Previous)
        );
        assert_eq!(parse_command(Vec::<String>::new()).unwrap(), None);
    }

    #[test]
    fn rejects_unknown_or_multiple_commands() {
        assert!(parse_command(["--anything".to_owned()]).is_err());
        assert!(parse_command(["--next".to_owned(), "--previous".to_owned()]).is_err());
    }

    #[test]
    fn command_support_is_checked_before_dispatch() {
        assert!(is_command_supported(
            PlaybackCommand::PlayPause,
            true,
            false,
            false
        ));
        assert!(!is_command_supported(
            PlaybackCommand::Next,
            true,
            false,
            true
        ));
        assert!(is_command_supported(
            PlaybackCommand::Previous,
            false,
            true,
            true
        ));
    }
}
