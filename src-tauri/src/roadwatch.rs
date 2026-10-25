use futures_util::{StreamExt, stream};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::HashMap, time::Duration};

const TRUCKERSMP_API: &str = "https://api.truckersmp.com/v2";
const LIVE_AREA_URL: &str = "https://tracker.ets2map.com/v3/area";
const USER_AGENT: &str = "LegionOS RoadWatch/1.0";

#[derive(Clone, Debug, Deserialize)]
struct ApiEnvelope<T> {
    #[serde(default)]
    error: Value,
    response: T,
}

#[derive(Debug, Deserialize)]
struct VtcMembersResponse {
    #[serde(default)]
    members: Vec<VtcMember>,
}

#[derive(Debug, Deserialize)]
struct VtcMember {
    #[serde(default)]
    id: u64,
    #[serde(default, rename = "user_id")]
    user_id: u64,
    #[serde(default)]
    username: String,
    #[serde(default)]
    avatar: Option<String>,
    #[serde(default)]
    role: Option<String>,
    #[serde(default)]
    rank: Option<String>,
    #[serde(default)]
    rank_name: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
struct TruckersMpServer {
    #[serde(default)]
    id: u64,
    #[serde(default)]
    game: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    online: bool,
    #[serde(default)]
    event: bool,
    #[serde(default, rename = "specialEvent")]
    special_event: bool,
}

#[derive(Debug, Deserialize)]
struct LiveAreaResponse {
    #[serde(rename = "Success")]
    success: bool,
    #[serde(rename = "Data", default)]
    data: Vec<TrackerPlayer>,
}

#[derive(Debug, Deserialize)]
struct TrackerPlayer {
    #[serde(rename = "X")]
    x: f64,
    #[serde(rename = "Y")]
    y: f64,
    #[serde(rename = "MpId")]
    mp_id: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum Game {
    Ets2,
    Ats,
}

impl Game {
    fn label(&self) -> &'static str {
        match self {
            Self::Ets2 => "ets2",
            Self::Ats => "ats",
        }
    }
}

#[derive(Clone, Debug)]
struct LivePlayer {
    game: Game,
    server: String,
    x: f64,
    y: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoadWatchMember {
    pub id: u64,
    pub truckersmp_id: u64,
    pub username: String,
    pub role: String,
    pub avatar_url: Option<String>,
    pub online: bool,
    pub game: Option<String>,
    pub server: Option<String>,
    pub distance_km: Option<f64>,
    pub is_current_user: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoadWatchData {
    pub members: Vec<RoadWatchMember>,
    pub online_count: usize,
    pub live_data_available: bool,
    pub live_error: Option<String>,
}

pub fn validate_ids(vtc_id: &str, truckersmp_id: &str) -> Result<(), String> {
    if !valid_numeric_id(vtc_id) {
        return Err(
            "Bitte eine gültige numerische TruckersMP-VTC-ID in den Einstellungen eintragen."
                .into(),
        );
    }
    if !valid_numeric_id(truckersmp_id) {
        return Err("Bitte eine gültige numerische persönliche TruckersMP-ID in den Einstellungen eintragen.".into());
    }
    Ok(())
}

fn valid_numeric_id(value: &str) -> bool {
    !value.is_empty() && value.len() <= 20 && value.bytes().all(|byte| byte.is_ascii_digit())
}

pub async fn load_data(vtc_id: &str, truckersmp_id: &str) -> Result<RoadWatchData, String> {
    validate_ids(vtc_id, truckersmp_id)?;
    let client = Client::builder()
        .timeout(Duration::from_secs(12))
        .user_agent(USER_AGENT)
        .build()
        .map_err(|error| format!("HTTP-Client konnte nicht gestartet werden: {error}"))?;

    let endpoint = format!("{TRUCKERSMP_API}/vtc/{vtc_id}/members");
    let response = client
        .get(endpoint)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|error| format!("TruckersMP-Mitglieder konnten nicht geladen werden: {error}"))?
        .error_for_status()
        .map_err(|error| format!("TruckersMP-Mitgliederanfrage fehlgeschlagen: {error}"))?;
    let envelope: ApiEnvelope<VtcMembersResponse> = response
        .json()
        .await
        .map_err(|error| format!("TruckersMP-Mitgliederdaten sind ungültig: {error}"))?;
    if api_reports_error(&envelope.error) {
        return Err(
            "TruckersMP hat die VTC-Anfrage abgelehnt. Prüfe die VTC-ID in den Einstellungen."
                .into(),
        );
    }

    let live_result = fetch_live_players(&client).await;
    let (live_players, live_data_available, live_error) = match live_result {
        Ok(players) => (players, true, None),
        Err(error) => (HashMap::new(), false, Some(error)),
    };
    let current_user_id = truckersmp_id.parse::<u64>().unwrap_or_default();
    let own_live = live_players.get(&current_user_id);
    let mut members = envelope
        .response
        .members
        .into_iter()
        .map(|member| {
            let truckersmp_id = member.user_id;
            let live = live_players.get(&truckersmp_id);
            let role = member
                .role
                .or(member.rank_name)
                .or(member.rank)
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "VTC-Mitglied".into());
            let distance_km = match (own_live, live) {
                (Some(own), Some(other)) if own.game == other.game => Some(
                    (((other.x - own.x).powi(2) + (other.y - own.y).powi(2)).sqrt() * 19.0)
                        / 1000.0,
                ),
                _ => None,
            };
            RoadWatchMember {
                id: member.id,
                truckersmp_id,
                username: member.username,
                role,
                avatar_url: member.avatar,
                online: live.is_some(),
                game: live.map(|player| player.game.label().to_string()),
                server: live.map(|player| player.server.clone()),
                distance_km,
                is_current_user: truckersmp_id == current_user_id,
            }
        })
        .collect::<Vec<_>>();
    members.sort_by(|left, right| {
        right.online.cmp(&left.online).then_with(|| {
            left.username
                .to_lowercase()
                .cmp(&right.username.to_lowercase())
        })
    });
    let online_count = members.iter().filter(|member| member.online).count();

    Ok(RoadWatchData {
        members,
        online_count,
        live_data_available,
        live_error,
    })
}

fn api_reports_error(error: &Value) -> bool {
    error.as_bool().unwrap_or_else(|| {
        error
            .as_str()
            .is_some_and(|value| value.eq_ignore_ascii_case("true"))
    })
}

async fn fetch_live_players(client: &Client) -> Result<HashMap<u64, LivePlayer>, String> {
    let response = client
        .get(format!("{TRUCKERSMP_API}/servers"))
        .send()
        .await
        .map_err(|error| format!("TruckersMP-Serverliste konnte nicht geladen werden: {error}"))?
        .error_for_status()
        .map_err(|error| format!("TruckersMP-Serveranfrage fehlgeschlagen: {error}"))?;
    let envelope: ApiEnvelope<Vec<TruckersMpServer>> = response
        .json()
        .await
        .map_err(|error| format!("TruckersMP-Serverliste ist ungültig: {error}"))?;
    if api_reports_error(&envelope.error) {
        return Err("TruckersMP hat die Serverlistenanfrage abgelehnt.".into());
    }

    let servers = envelope
        .response
        .into_iter()
        .filter_map(|server| {
            let game = if server.game.eq_ignore_ascii_case("ETS2") {
                Game::Ets2
            } else if server.game.eq_ignore_ascii_case("ATS") {
                Game::Ats
            } else {
                return None;
            };
            if !server.online || server.event || server.special_event {
                return None;
            }
            Some((server, game))
        })
        .collect::<Vec<_>>();
    let attempted = servers.len();
    let results = stream::iter(
        servers
            .into_iter()
            .map(|(server, game)| async move { fetch_server_area(client, server, game).await }),
    )
    .buffer_unordered(4)
    .collect::<Vec<_>>()
    .await;

    let mut players = HashMap::new();
    let mut errors = Vec::new();
    let mut successful = 0usize;
    for result in results {
        match result {
            Ok(server_players) => {
                successful += 1;
                players.extend(server_players);
            }
            Err(error) => errors.push(error),
        }
    }
    if attempted > 0 && successful == 0 {
        return Err(format!(
            "ETS2Map-Livedaten konnten nicht geladen werden: {}",
            errors.join("; ")
        ));
    }
    Ok(players)
}

async fn fetch_server_area(
    client: &Client,
    server: TruckersMpServer,
    game: Game,
) -> Result<HashMap<u64, LivePlayer>, String> {
    let tracker_server_id = tracker_server_id(server.id, &game);
    let area = match game {
        Game::Ets2 => (-88026, 140789, 72774, -106596),
        Game::Ats => (-250000, 150000, 100000, -150000),
    };
    let response = client
        .get(LIVE_AREA_URL)
        .query(&[
            ("x1", area.0),
            ("y1", area.1),
            ("x2", area.2),
            ("y2", area.3),
            ("server", tracker_server_id as i64),
        ])
        .send()
        .await
        .map_err(|error| format!("{}: {error}", server.name))?
        .error_for_status()
        .map_err(|error| format!("{}: {error}", server.name))?;
    let area: LiveAreaResponse = response
        .json()
        .await
        .map_err(|error| format!("ETS2Map-Daten für {} sind ungültig: {error}", server.name))?;
    if !area.success {
        return Ok(HashMap::new());
    }
    Ok(area
        .data
        .into_iter()
        .map(|player| {
            (
                player.mp_id,
                LivePlayer {
                    game: game.clone(),
                    server: server.name.clone(),
                    x: player.x,
                    y: player.y,
                },
            )
        })
        .collect())
}

fn tracker_server_id(server_id: u64, game: &Game) -> u64 {
    match (game, server_id) {
        (Game::Ets2, 4) => 2,
        (Game::Ats, 9) => 8,
        (Game::Ats, 11) => 10,
        (Game::Ats, 38) => 45,
        _ => server_id,
    }
}
