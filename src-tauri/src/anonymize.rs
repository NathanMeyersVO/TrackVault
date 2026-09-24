use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};

use fake::faker::name::en::Name;
use fake::Fake;
use rand::rngs::StdRng;
use rand::SeedableRng;
use lofty::config::WriteOptions;
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::probe::Probe;
use lofty::tag::{Accessor, Tag};
use walkdir::WalkDir;

use crate::scanner::{is_audio_file, read_tags};

pub const DEFAULT_OUTPUT_SUBDIR: &str = "DEMO_COPY";
pub const DEFAULT_SEED: u64 = 42;

#[derive(Debug, Clone)]
pub struct AnonymizeOptions {
    pub library_root: PathBuf,
    pub output_subdir: String,
    pub seed: u64,
    pub dry_run: bool,
    pub strict: bool,
}

#[derive(Debug, Clone, Default)]
pub struct AnonymizeReport {
    pub copied: u32,
    pub skipped: u32,
    pub warnings: Vec<String>,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone)]
struct TrackPlan {
    source: PathBuf,
    destination: PathBuf,
    fake_name: String,
}

pub fn replace_filename_stem(skater_name: &str, stem: &str, fake_name: &str) -> Option<String> {
    if skater_name.is_empty() || !stem.starts_with(skater_name) {
        return None;
    }
    let suffix = &stem[skater_name.len()..];
    Some(format!("{fake_name}{suffix}"))
}

pub fn build_fake_name_map(skater_names: &[String], seed: u64) -> HashMap<String, String> {
    let mut unique: Vec<String> = skater_names
        .iter()
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
        .collect();
    unique.sort_unstable();
    unique.dedup();

    let mut map = HashMap::new();
    for (index, real_name) in unique.into_iter().enumerate() {
        let mut rng = StdRng::seed_from_u64(seed.wrapping_add(index as u64));
        let fake_name: String = Name().fake_with_rng(&mut rng);
        map.insert(real_name, fake_name);
    }
    map
}

pub fn anonymize_library(opts: AnonymizeOptions) -> Result<AnonymizeReport, String> {
    let library_root = opts
        .library_root
        .canonicalize()
        .map_err(|e| format!("Invalid project library path: {e}"))?;

    if !library_root.is_dir() {
        return Err("Project library path is not a directory.".to_string());
    }

    let output_root = library_root.join(&opts.output_subdir);
    let output_root_prefix = output_root
        .canonicalize()
        .unwrap_or_else(|_| output_root.clone());

    let mut sources: Vec<PathBuf> = Vec::new();
    for entry in WalkDir::new(&library_root)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if !path.is_file() || !is_audio_file(path) {
            continue;
        }
        if path.starts_with(&output_root) || path.starts_with(&output_root_prefix) {
            continue;
        }
        sources.push(path.to_path_buf());
    }
    sources.sort_unstable();

    let mut skater_names: Vec<String> = Vec::new();
    let mut stem_by_source: BTreeMap<PathBuf, String> = BTreeMap::new();

    for source in &sources {
        let (title, _, _, _, _) = read_tags(source);
        let skater_name = title.trim().to_string();
        let stem = source
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        stem_by_source.insert(source.clone(), stem);
        skater_names.push(skater_name);
    }

    let fake_map = build_fake_name_map(&skater_names, opts.seed);

    let mut plans: Vec<TrackPlan> = Vec::new();
    let mut report = AnonymizeReport::default();

    for source in sources {
        let skater_name = read_tags(&source).0.trim().to_string();
        let stem = stem_by_source
            .get(&source)
            .cloned()
            .unwrap_or_default();

        if skater_name.is_empty() {
            let msg = format!("Skipping {:?}: empty Track Title", source);
            report.warnings.push(msg);
            report.skipped += 1;
            continue;
        }

        let Some(fake_name) = fake_map.get(&skater_name) else {
            let msg = format!("Skipping {:?}: no fake name for \"{skater_name}\"", source);
            report.warnings.push(msg);
            report.skipped += 1;
            continue;
        };

        let Some(new_stem) = replace_filename_stem(&skater_name, &stem, fake_name) else {
            let msg = format!(
                "Skipping {:?}: filename stem does not start with title \"{skater_name}\"",
                source
            );
            report.warnings.push(msg);
            report.skipped += 1;
            continue;
        };

        let extension = source
            .extension()
            .map(|ext| format!(".{}", ext.to_string_lossy()))
            .unwrap_or_default();

        let relative = source
            .strip_prefix(&library_root)
            .map_err(|e| format!("Path not under project library root: {e}"))?;
        let relative_parent = relative.parent().unwrap_or(Path::new(""));
        let dest_dir = output_root.join(relative_parent);
        let destination = dest_dir.join(format!("{new_stem}{extension}"));

        plans.push(TrackPlan {
            source,
            destination,
            fake_name: fake_name.clone(),
        });
    }

    if opts.strict && !report.warnings.is_empty() {
        return Err(format!(
            "Strict mode: {} file(s) could not be processed",
            report.warnings.len()
        ));
    }

    for plan in plans {
        if opts.dry_run {
            eprintln!(
                "[dry-run] {:?} -> {:?} (title: {})",
                plan.source, plan.destination, plan.fake_name
            );
            report.copied += 1;
            continue;
        }

        if let Some(parent) = plan.destination.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                format!("Failed to create {:?}: {e}", parent)
            })?;
        }

        match std::fs::copy(&plan.source, &plan.destination) {
            Ok(_) => {}
            Err(e) => {
                report.errors.push(format!(
                    "Failed to copy {:?} to {:?}: {e}",
                    plan.source, plan.destination
                ));
                continue;
            }
        }

        match write_track_title(&plan.destination, &plan.fake_name) {
            Ok(()) => report.copied += 1,
            Err(e) => {
                report.errors.push(format!(
                    "Copied {:?} but failed to set title: {e}",
                    plan.destination
                ));
            }
        }
    }

    Ok(report)
}

fn write_track_title(path: &Path, title: &str) -> Result<(), String> {
    let mut tagged = Probe::open(path)
        .map_err(|e| format!("Failed to open file: {e}"))?
        .read()
        .map_err(|e| format!("Failed to read file: {e}"))?;

    if !tagged.file_type().supports_tag_type(tagged.primary_tag_type()) {
        return Err("This file format does not support tag writing.".to_string());
    }

    let tag_type = tagged.primary_tag_type();
    if tagged.primary_tag_mut().is_none() {
        tagged.insert_tag(Tag::new(tag_type));
    }

    let tag = tagged
        .primary_tag_mut()
        .ok_or("Failed to access writable tag")?;

    tag.set_title(title.to_string());

    tagged
        .save_to_path(path, WriteOptions::default())
        .map_err(|e| format!("Failed to write tags: {e}"))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replace_stem_swaps_name_prefix() {
        assert_eq!(
            replace_filename_stem("Alice Jones", "Alice JonesShort Program", "Bob Smith"),
            Some("Bob SmithShort Program".to_string())
        );
    }

    #[test]
    fn replace_stem_requires_prefix() {
        assert_eq!(
            replace_filename_stem("Alice Jones", "Bob JonesShort", "Bob Smith"),
            None
        );
    }

    #[test]
    fn fake_map_is_stable_and_unique() {
        let names = vec![
            "Zara".to_string(),
            "Amy".to_string(),
            "Amy".to_string(),
        ];
        let map = build_fake_name_map(&names, 99);
        assert_eq!(map.len(), 2);
        assert_eq!(map.get("Amy"), map.get("Amy"));
        let map2 = build_fake_name_map(&names, 99);
        assert_eq!(map, map2);
        assert_ne!(map.get("Amy"), map.get("Zara"));
    }
}
