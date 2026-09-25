//! Build an EMS-style demo drop folder from an event schedule and a track pool.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use lofty::config::WriteOptions;
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::probe::Probe;
use lofty::tag::{Accessor, ItemKey, Tag, TagType};
use rand::seq::SliceRandom;
use rand::{Rng, SeedableRng};
use rand::rngs::StdRng;
use walkdir::WalkDir;

use crate::anonymize::build_fake_name_map;
use crate::projects::canonical_schedule_relative_path;
use crate::scanner::is_audio_file;
use crate::title_map;
use crate::waveform::probe_duration_ms;

pub const DEFAULT_SEED: u64 = 42;
pub const DEFAULT_COMPETITORS_MIN: u32 = 8;
pub const DEFAULT_COMPETITORS_MAX: u32 = 14;
pub const DEFAULT_MULTI_EVENT_2_WEIGHT: f64 = 0.30;
pub const DEFAULT_MULTI_EVENT_3_WEIGHT: f64 = 0.20;
pub const MIN_POOL_TRACK_DURATION_MS: i64 = 60_000;
pub const DEFAULT_MIN_DURATION_SECS: u64 = 60;

const MAX_WALK_ATTEMPTS: u32 = 10_000;

#[derive(Debug, Clone)]
pub struct GenerateDemoOptions {
    pub schedule_path: PathBuf,
    pub output_dir: PathBuf,
    pub track_pool_dir: PathBuf,
    pub seed: u64,
    pub competitors_min: u32,
    pub competitors_max: u32,
    pub multi_event_2_weight: f64,
    pub multi_event_3_weight: f64,
    pub min_duration_ms: i64,
    pub dry_run: bool,
}

#[derive(Debug, Clone)]
pub struct PlannedTrack {
    pub event_id: String,
    pub skater_name: String,
    pub relative_path: String,
    pub pool_source: PathBuf,
}

#[derive(Debug, Clone, Default)]
pub struct GenerateDemoReport {
    pub tracks_planned: u32,
    pub tracks_written: u32,
    pub unique_skaters: u32,
    pub schedule_dest: Option<PathBuf>,
    pub lines: Vec<String>,
    pub warnings: Vec<String>,
}

pub fn generate_demo_dataset(opts: GenerateDemoOptions) -> Result<GenerateDemoReport, String> {
    validate_options(&opts)?;

    let schedule_map = title_map::parse_usfs_ems_schedule(&opts.schedule_path)?;
    let event_ids = sort_event_ids(schedule_map.keys().cloned().collect());

    let (roster, roster_trims) = build_roster(
        &event_ids,
        opts.seed,
        opts.competitors_min,
        opts.competitors_max,
        opts.multi_event_2_weight,
        opts.multi_event_3_weight,
    )?;

    let mut planned = plan_tracks(&event_ids, &roster)?;
    let pool_index = build_pool_index(&opts.track_pool_dir, opts.min_duration_ms)?;
    assign_pool_sources(
        &mut planned,
        &pool_index.pool_root,
        &pool_index,
        opts.seed,
    )?;

    let schedule_dest_name = canonical_schedule_relative_path(&opts.schedule_path);
    let schedule_dest = opts.output_dir.join(schedule_dest_name);

    let unique_skaters = roster.len() as u32;
    let mut report = GenerateDemoReport {
        tracks_planned: planned.len() as u32,
        unique_skaters,
        schedule_dest: Some(schedule_dest.clone()),
        ..Default::default()
    };
    if roster_trims > 0 {
        report.warnings.push(format!(
            "Trimmed {roster_trims} event assignment(s) to satisfy --competitors-max ({}).",
            opts.competitors_max
        ));
    }

    if opts.dry_run {
        for track in &planned {
            report.lines.push(format!(
                "{}  event={}  skater={}  pool={}",
                track.relative_path,
                track.event_id,
                track.skater_name,
                track.pool_source.display()
            ));
        }
        report.lines.push(format!(
            "Would copy schedule to {}",
            schedule_dest.display()
        ));
        return Ok(report);
    }

    fs::create_dir_all(&opts.output_dir).map_err(|e| e.to_string())?;
    fs::copy(&opts.schedule_path, &schedule_dest)
        .map_err(|e| format!("Failed to copy schedule: {e}"))?;

    for track in &planned {
        let dest = opts.output_dir.join(&track.relative_path);
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::copy(&track.pool_source, &dest)
            .map_err(|e| format!("Failed to copy {}: {e}", track.pool_source.display()))?;
        write_ems_tags(
            &dest,
            &track.skater_name,
            &track.event_id,
            Some(&track.pool_source),
        )?;
        report.tracks_written += 1;
    }

    Ok(report)
}

fn validate_options(opts: &GenerateDemoOptions) -> Result<(), String> {
    if opts.competitors_min == 0 {
        return Err("--competitors-min must be at least 1".to_string());
    }
    if opts.competitors_max < opts.competitors_min {
        return Err("--competitors-max must be >= --competitors-min".to_string());
    }
    let w2 = opts.multi_event_2_weight;
    let w3 = opts.multi_event_3_weight;
    if w2 < 0.0 || w3 < 0.0 || w2 + w3 > 1.0 {
        return Err(
            "Multi-event weights must be non-negative and sum to at most 1".to_string(),
        );
    }
    if !opts.schedule_path.is_file() {
        return Err(format!(
            "Schedule file not found: {}",
            opts.schedule_path.display()
        ));
    }
    if !opts.track_pool_dir.is_dir() {
        return Err(format!(
            "Track pool directory not found: {}",
            opts.track_pool_dir.display()
        ));
    }
    if opts.min_duration_ms < 0 {
        return Err("--min-duration-secs must be non-negative".to_string());
    }
    Ok(())
}

fn sort_event_ids(mut ids: Vec<String>) -> Vec<String> {
    ids.sort_by(|a, b| {
        let na = a.trim().parse::<u32>().ok();
        let nb = b.trim().parse::<u32>().ok();
        match (na, nb) {
            (Some(na), Some(nb)) => na.cmp(&nb),
            _ => a.cmp(b),
        }
    });
    ids
}

struct SkaterRosterEntry {
    name: String,
    events: Vec<String>,
}

fn build_roster(
    event_ids: &[String],
    seed: u64,
    competitors_min: u32,
    competitors_max: u32,
    multi_event_2_weight: f64,
    multi_event_3_weight: f64,
) -> Result<(Vec<SkaterRosterEntry>, u32), String> {
    if event_ids.is_empty() {
        return Err("Schedule contains no events".to_string());
    }

    let w1 = (1.0 - multi_event_2_weight - multi_event_3_weight).max(0.0);
    let avg_events_per_skater =
        w1 * 1.0 + multi_event_2_weight * 2.0 + multi_event_3_weight * 3.0;
    let target_avg = (competitors_min + competitors_max) as f64 / 2.0;
    let total_slots_target = (target_avg * event_ids.len() as f64).ceil() as u32;
    let initial_count = ((total_slots_target as f64 / avg_events_per_skater.max(0.01)).ceil()
        as u32)
        .max(1);

    let placeholders: Vec<String> = (0..initial_count)
        .map(|i| format!("__demo_skater_{i}__"))
        .collect();
    let fake_map = build_fake_name_map(&placeholders, seed);
    let fake_names: Vec<String> = placeholders
        .iter()
        .map(|key| {
            fake_map
                .get(key)
                .cloned()
                .unwrap_or_else(|| key.clone())
        })
        .collect();

    let mut rng = StdRng::seed_from_u64(seed);
    let mut roster: Vec<SkaterRosterEntry> = fake_names
        .into_iter()
        .map(|name| {
            let count = event_count_for_skater(
                &mut rng,
                w1,
                multi_event_2_weight,
                multi_event_3_weight,
                event_ids.len(),
            );
            let events = pick_distinct_events(&mut rng, event_ids, count);
            SkaterRosterEntry { name, events }
        })
        .collect();

    let mut by_event: HashMap<String, Vec<String>> = HashMap::new();
    for event_id in event_ids {
        by_event.insert(event_id.clone(), Vec::new());
    }
    for entry in &roster {
        for event_id in &entry.events {
            if let Some(list) = by_event.get_mut(event_id) {
                list.push(entry.name.clone());
            }
        }
    }

    let mut next_placeholder_index = initial_count;
    for event_id in event_ids {
        while by_event[event_id].len() < competitors_min as usize {
            let key = format!("__demo_skater_{next_placeholder_index}__");
            next_placeholder_index += 1;
            let name = build_fake_name_map(
                std::slice::from_ref(&key),
                seed.wrapping_add(next_placeholder_index as u64),
            )
            .get(&key)
            .cloned()
            .unwrap_or(key);
            by_event
                .get_mut(event_id)
                .expect("event in map")
                .push(name.clone());
            roster.push(SkaterRosterEntry {
                name,
                events: vec![event_id.clone()],
            });
        }
    }

    let trims = trim_roster_to_max(&mut roster, event_ids, competitors_max, seed);
    Ok((roster, trims))
}

fn rebuild_by_event(
    roster: &[SkaterRosterEntry],
    event_ids: &[String],
) -> HashMap<String, Vec<String>> {
    let mut by_event: HashMap<String, Vec<String>> = HashMap::new();
    for event_id in event_ids {
        by_event.insert(event_id.clone(), Vec::new());
    }
    for entry in roster {
        for event_id in &entry.events {
            if let Some(list) = by_event.get_mut(event_id) {
                list.push(entry.name.clone());
            }
        }
    }
    by_event
}

fn trim_roster_to_max(
    roster: &mut Vec<SkaterRosterEntry>,
    event_ids: &[String],
    competitors_max: u32,
    seed: u64,
) -> u32 {
    let max = competitors_max as usize;
    let mut trims = 0u32;
    let mut rng = StdRng::seed_from_u64(seed.wrapping_add(77_031));

    loop {
        let by_event = rebuild_by_event(roster, event_ids);
        let Some(event_id) = event_ids
            .iter()
            .filter(|id| by_event.get(*id).map(|v| v.len()).unwrap_or(0) > max)
            .max_by(|a, b| {
                let ca = by_event.get(*a).map(|v| v.len()).unwrap_or(0);
                let cb = by_event.get(*b).map(|v| v.len()).unwrap_or(0);
                ca.cmp(&cb).then_with(|| a.cmp(b))
            })
            .cloned()
        else {
            break;
        };

        let skaters = by_event.get(&event_id).cloned().unwrap_or_default();
        let event_counts: HashMap<String, usize> = roster
            .iter()
            .map(|entry| (entry.name.clone(), entry.events.len()))
            .collect();

        let mut multi_event: Vec<&String> = skaters
            .iter()
            .filter(|name| event_counts.get(*name).copied().unwrap_or(0) >= 2)
            .collect();
        let pick_name = if !multi_event.is_empty() {
            multi_event.sort_by(|a, b| {
                event_counts[*b]
                    .cmp(&event_counts[*a])
                    .then_with(|| a.cmp(b))
            });
            let top_count = event_counts[multi_event[0]];
            let mut ties: Vec<&String> = multi_event
                .into_iter()
                .filter(|name| event_counts[*name] == top_count)
                .collect();
            ties.shuffle(&mut rng);
            ties[0].clone()
        } else {
            let mut singles = skaters;
            singles.shuffle(&mut rng);
            singles[0].clone()
        };

        if let Some(entry) = roster.iter_mut().find(|e| e.name == pick_name) {
            if entry.events.len() > 1 {
                entry.events.retain(|e| e != &event_id);
            } else {
                entry.events.clear();
            }
        }
        roster.retain(|entry| !entry.events.is_empty());
        trims += 1;
    }

    trims
}

fn event_count_for_skater(
    rng: &mut StdRng,
    w1: f64,
    w2: f64,
    w3: f64,
    num_events: usize,
) -> usize {
    let max_count = num_events.min(3);
    if max_count <= 1 {
        return 1;
    }
    let mut count = if max_count == 2 {
        let _ = w3;
        let two_event_share = w2 / (w1 + w2).max(0.001);
        if rng.gen::<f64>() < 1.0 - two_event_share {
            1
        } else {
            2
        }
    } else {
        let roll: f64 = rng.gen();
        if roll < w1 {
            1
        } else if roll < w1 + w2 {
            2
        } else {
            3
        }
    };
    count = count.min(max_count);
    count.max(1)
}

fn pick_distinct_events(rng: &mut StdRng, event_ids: &[String], count: usize) -> Vec<String> {
    let mut shuffled = event_ids.to_vec();
    shuffled.shuffle(rng);
    shuffled.into_iter().take(count).collect()
}

fn plan_tracks(
    event_ids: &[String],
    roster: &[SkaterRosterEntry],
) -> Result<Vec<PlannedTrack>, String> {
    let mut planned = Vec::new();
    for entry in roster {
        for event_id in &entry.events {
            if !event_ids.iter().any(|id| id == event_id) {
                continue;
            }
            planned.push(PlannedTrack {
                event_id: event_id.clone(),
                skater_name: entry.name.clone(),
                relative_path: String::new(),
                pool_source: PathBuf::new(),
            });
        }
    }
    planned.sort_by(|a, b| {
        match (
            a.event_id.parse::<u32>().ok(),
            b.event_id.parse::<u32>().ok(),
        ) {
            (Some(ea), Some(eb)) => ea
                .cmp(&eb)
                .then_with(|| a.skater_name.cmp(&b.skater_name)),
            _ => a
                .event_id
                .cmp(&b.event_id)
                .then_with(|| a.skater_name.cmp(&b.skater_name)),
        }
    });
    Ok(planned)
}

#[derive(Debug, Clone)]
pub struct PoolIndex {
    pub pool_root: PathBuf,
    subdirs: HashMap<PathBuf, Vec<PathBuf>>,
    eligible_files: HashMap<PathBuf, Vec<PathBuf>>,
    pub total_eligible: usize,
}

pub fn pool_track_eligible(path: &Path, min_duration_ms: i64) -> bool {
    match probe_duration_ms(path) {
        Some(ms) => ms > min_duration_ms,
        None => false,
    }
}

pub fn build_pool_index(pool_root: &Path, min_duration_ms: i64) -> Result<PoolIndex, String> {
    let pool_root = pool_root
        .canonicalize()
        .map_err(|e| format!("Invalid --track-pool path: {e}"))?;

    let mut dirs: HashSet<PathBuf> = HashSet::new();
    dirs.insert(pool_root.clone());

    for entry in WalkDir::new(&pool_root)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if entry.file_type().is_dir() {
            dirs.insert(entry.path().to_path_buf());
        }
    }

    let mut subdirs: HashMap<PathBuf, Vec<PathBuf>> = HashMap::new();
    let mut eligible_files: HashMap<PathBuf, Vec<PathBuf>> = HashMap::new();
    let mut total_eligible = 0usize;

    for dir in &dirs {
        let read = fs::read_dir(dir).map_err(|e| format!("Read {}: {e}", dir.display()))?;
        let mut child_dirs = Vec::new();
        let mut files = Vec::new();
        for entry in read.filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.is_dir() {
                child_dirs.push(path);
            } else if is_audio_file(&path) && pool_track_eligible(&path, min_duration_ms) {
                files.push(path);
                total_eligible += 1;
            }
        }
        child_dirs.sort_unstable();
        files.sort_unstable();
        subdirs.insert(dir.clone(), child_dirs);
        eligible_files.insert(dir.clone(), files);
    }

    if total_eligible == 0 {
        let min_secs = min_duration_ms / 1000;
        return Err(format!(
            "No audio files longer than {min_secs}s found under {}",
            pool_root.display()
        ));
    }

    Ok(PoolIndex {
        pool_root,
        subdirs,
        eligible_files,
        total_eligible,
    })
}

pub fn pick_pool_track_random_walk(
    pool_root: &Path,
    index: &PoolIndex,
    used: &mut HashSet<PathBuf>,
    rng: &mut StdRng,
) -> Result<PathBuf, String> {
    for _ in 0..MAX_WALK_ATTEMPTS {
        let mut dir = pool_root.to_path_buf();
        loop {
            let files = index
                .eligible_files
                .get(&dir)
                .map(|v| v.as_slice())
                .unwrap_or(&[]);
            let candidates: Vec<&PathBuf> = files.iter().filter(|p| !used.contains(*p)).collect();
            let children = index
                .subdirs
                .get(&dir)
                .map(|v| v.as_slice())
                .unwrap_or(&[]);

            if !candidates.is_empty()
                && (children.is_empty() || rng.gen_bool(0.5))
            {
                let pick = candidates[rng.gen_range(0..candidates.len())];
                used.insert(pick.clone());
                return Ok(pick.clone());
            }

            if children.is_empty() {
                break;
            }
            dir = children[rng.gen_range(0..children.len())].clone();
        }
    }

    Err(
        "Could not assign a unique pool track via random folder walk. \
Try adding more eligible audio or reducing roster size."
            .to_string(),
    )
}

fn assign_pool_sources(
    planned: &mut [PlannedTrack],
    pool_root: &Path,
    index: &PoolIndex,
    seed: u64,
) -> Result<(), String> {
    if planned.len() > index.total_eligible {
        return Err(format!(
            "Need {} unique pool tracks longer than the minimum duration but only {} eligible under --track-pool. \
Add more audio or reduce --competitors-min / --competitors-max.",
            planned.len(),
            index.total_eligible
        ));
    }

    let mut used: HashSet<PathBuf> = HashSet::new();

    for (slot, track) in planned.iter_mut().enumerate() {
        let mut slot_rng =
            StdRng::seed_from_u64(seed.wrapping_add(9_001).wrapping_add(slot as u64 * 997));
        let source = pick_pool_track_random_walk(pool_root, index, &mut used, &mut slot_rng)?;
        track.pool_source = source.clone();
        let ext = source
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("mp3");
        let stem = sanitize_file_stem(&track.skater_name);
        track.relative_path = format!("tracks/{}/{}.{}", track.event_id, stem, ext);
    }
    Ok(())
}

fn sanitize_file_stem(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    for ch in name.chars() {
        if matches!(ch, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
            out.push('_');
        } else {
            out.push(ch);
        }
    }
    let trimmed = out.trim();
    if trimmed.is_empty() {
        "Skater".to_string()
    } else {
        trimmed.to_string()
    }
}

fn clear_supported_tags(tagged: &mut lofty::file::TaggedFile) {
    for tag_type in [
        TagType::Id3v2,
        TagType::Id3v1,
        TagType::Ape,
        TagType::Mp4Ilst,
        TagType::VorbisComments,
        TagType::RiffInfo,
    ] {
        if tagged.file_type().supports_tag_type(tag_type) {
            tagged.remove(tag_type);
        }
    }
}

fn write_ems_tags(
    path: &Path,
    track_title: &str,
    composer: &str,
    pool_source: Option<&Path>,
) -> Result<(), String> {
    let path_label = path.display();
    let mut tagged = Probe::open(path)
        .map_err(|e| format!("Failed to open {path_label}: {e}"))?
        .read()
        .map_err(|e| format!("Failed to read {path_label}: {e}"))?;

    let tag_type = tagged.primary_tag_type();
    if !tagged.file_type().supports_tag_type(tag_type) {
        return Err(format!("Cannot write tags to {path_label}"));
    }

    clear_supported_tags(&mut tagged);

    let mut tag = Tag::new(tag_type);
    tag.set_title(track_title.to_string());
    tag.insert_text(ItemKey::Composer, composer.to_string());
    tagged.insert_tag(tag);

    tagged
        .save_to_path(path, WriteOptions::default())
        .map_err(|e| tag_write_error(path, pool_source, e))
}

fn tag_write_error(path: &Path, pool_source: Option<&Path>, error: lofty::error::LoftyError) -> String {
    let mut msg = format!(
        "Failed to write tags to {}: {error}",
        path.display()
    );
    if let Some(src) = pool_source {
        msg.push_str(&format!(" (pool source: {})", src.display()));
    }
    msg
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn write_schedule_xlsx(path: &Path, rows: &[(&str, &str)]) {
        use rust_xlsxwriter::{Workbook, Worksheet};
        let mut workbook = Workbook::new();
        let mut worksheet = Worksheet::new();
        worksheet.set_name("Event Schedule").unwrap();
        worksheet.write_string(0, 0, "#").unwrap();
        worksheet.write_string(0, 1, "Title").unwrap();
        for (i, (num, title)) in rows.iter().enumerate() {
            let row = (i + 1) as u32;
            worksheet.write_string(row, 0, *num).unwrap();
            worksheet.write_string(row, 1, *title).unwrap();
        }
        workbook.push_worksheet(worksheet);
        workbook.save(path).unwrap();
    }

    #[test]
    fn roster_respects_min_per_event() {
        let events = vec!["01".to_string(), "02".to_string(), "03".to_string()];
        let roster = build_roster(&events, 7, 5, 8, 0.3, 0.2).unwrap().0;
        let mut counts: HashMap<String, usize> = HashMap::new();
        for e in &events {
            counts.insert(e.clone(), 0);
        }
        for entry in &roster {
            for e in &entry.events {
                *counts.get_mut(e).unwrap() += 1;
            }
        }
        for e in &events {
            assert!(
                counts[e] >= 5,
                "event {e} had {}",
                counts[e]
            );
            assert!(counts[e] <= 8, "event {e} had {}", counts[e]);
        }
        assert!(roster.iter().any(|s| s.events.len() >= 2));
    }

    fn event_counts(roster: &[SkaterRosterEntry], events: &[String]) -> HashMap<String, usize> {
        let mut counts: HashMap<String, usize> = HashMap::new();
        for e in events {
            counts.insert(e.clone(), 0);
        }
        for entry in roster {
            for e in &entry.events {
                if let Some(c) = counts.get_mut(e) {
                    *c += 1;
                }
            }
        }
        counts
    }

    #[test]
    fn roster_trims_to_competitors_max_instead_of_erroring() {
        let events: Vec<String> = (1..=6).map(|n| format!("{n:02}")).collect();
        let (roster, trims) = build_roster(&events, 11, 8, 10, 0.0, 0.9).unwrap();
        let counts = event_counts(&roster, &events);
        for e in &events {
            assert!(
                counts[e] >= 8 && counts[e] <= 10,
                "event {e} count {}",
                counts[e]
            );
        }
        assert!(trims > 0, "expected trimming with high multi-event-3 weight");
        assert!(roster.iter().any(|s| s.events.len() >= 2));
    }

    #[test]
    fn random_walk_assigns_unique_leaf_files() {
        let root = PathBuf::from(r"C:\pool");
        let branch = root.join("branch");
        let leaf = branch.join("leaf");
        let f1 = leaf.join("a.mp3");
        let f2 = leaf.join("b.mp3");
        let f3 = leaf.join("c.mp3");

        let index = PoolIndex {
            pool_root: root.clone(),
            subdirs: HashMap::from([
                (root.clone(), vec![branch.clone()]),
                (branch.clone(), vec![leaf.clone()]),
                (leaf.clone(), vec![]),
            ]),
            eligible_files: HashMap::from([
                (root.clone(), vec![]),
                (branch.clone(), vec![]),
                (leaf.clone(), vec![f1.clone(), f2.clone(), f3.clone()]),
            ]),
            total_eligible: 3,
        };

        let mut planned: Vec<PlannedTrack> = (0..3)
            .map(|i| PlannedTrack {
                event_id: "01".to_string(),
                skater_name: format!("Skater {i}"),
                relative_path: String::new(),
                pool_source: PathBuf::new(),
            })
            .collect();
        assign_pool_sources(&mut planned, &root, &index, 1).unwrap();
        let sources: HashSet<_> = planned.iter().map(|p| p.pool_source.clone()).collect();
        assert_eq!(sources.len(), 3);
        assert!(sources.iter().all(|p| p.parent() == Some(leaf.as_path())));

        let mut too_many = planned.clone();
        too_many.push(PlannedTrack {
            event_id: "01".to_string(),
            skater_name: "Extra".to_string(),
            relative_path: String::new(),
            pool_source: PathBuf::new(),
        });
        assert!(assign_pool_sources(&mut too_many, &root, &index, 1).is_err());
    }

    #[test]
    fn random_walk_skips_non_leaf_folders_for_files() {
        let root = PathBuf::from(r"C:\pool");
        let mid = root.join("mid");
        let leaf = mid.join("leaf");
        let root_file = root.join("only-at-root.mp3");
        let leaf_file = leaf.join("in-leaf.mp3");

        let index = PoolIndex {
            pool_root: root.clone(),
            subdirs: HashMap::from([
                (root.clone(), vec![mid.clone()]),
                (mid.clone(), vec![leaf.clone()]),
                (leaf.clone(), vec![]),
            ]),
            eligible_files: HashMap::from([
                (root.clone(), vec![root_file.clone()]),
                (mid.clone(), vec![]),
                (leaf.clone(), vec![leaf_file.clone()]),
            ]),
            total_eligible: 2,
        };

        let mut used = HashSet::new();
        let mut rng = StdRng::seed_from_u64(5);
        let first = pick_pool_track_random_walk(&root, &index, &mut used, &mut rng).unwrap();
        let second = pick_pool_track_random_walk(&root, &index, &mut used, &mut rng).unwrap();
        assert_ne!(first, second);
        assert!(
            first == root_file || first == leaf_file,
            "unexpected pick: {}",
            first.display()
        );
    }

    #[test]
    fn dry_run_does_not_write_files() {
        let base = std::env::temp_dir().join(format!("tv-demo-gen-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&base).unwrap();
        let schedule = base.join("sched.xlsx");
        write_schedule_xlsx(
            &schedule,
            &[("01", "Short"), ("02", "Free")],
        );
        let pool_dir = base.join("pool");
        fs::create_dir_all(&pool_dir).unwrap();
        fs::write(pool_dir.join("stub.mp3"), b"stub").unwrap();

        let out = base.join("out");
        let result = generate_demo_dataset(GenerateDemoOptions {
            schedule_path: schedule,
            output_dir: out.clone(),
            track_pool_dir: pool_dir,
            seed: 99,
            competitors_min: 1,
            competitors_max: 2,
            multi_event_2_weight: 0.5,
            multi_event_3_weight: 0.0,
            min_duration_ms: MIN_POOL_TRACK_DURATION_MS,
            dry_run: true,
        });
        assert!(result.is_err(), "stub files should not pass duration filter");
        assert!(!out.exists());
        let _ = fs::remove_dir_all(&base);
    }
}
