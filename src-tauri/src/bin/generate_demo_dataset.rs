use std::env;
use std::path::PathBuf;
use std::process::ExitCode;

use trackvault_lib::demo_dataset::{
    generate_demo_dataset, GenerateDemoOptions, DEFAULT_COMPETITORS_MAX,
    DEFAULT_COMPETITORS_MIN, DEFAULT_MULTI_EVENT_2_WEIGHT, DEFAULT_MULTI_EVENT_3_WEIGHT,
    DEFAULT_SEED, MIN_POOL_TRACK_DURATION_MS,
};

fn print_help() {
    eprintln!(
        r#"generate-demo-dataset — build an EMS import folder with fake skaters and pooled audio

Reads a US Figure Skating EMS Event Schedule spreadsheet, copies it into an output
folder, and generates tracks/{{event#}}/{{skater}}.{{ext}} with EMS tags:
Track Title = skater name, Composer = event #.

The track pool is a folder tree: each output track copies a distinct source file
chosen by walking from the pool root into random subfolders until a leaf folder,
then picking an unused file in that folder only. Only files longer than the
minimum duration (default: more than 1 minute) are eligible.

USAGE:
    generate-demo-dataset --schedule <PATH> --output <DIR> --track-pool <DIR> [OPTIONS]

OPTIONS:
    --schedule <PATH>              Event schedule .xls / .xlsx (required)
    --output <DIR>                 EMS drop folder to create (required)
    --track-pool <DIR>             Root folder of source audio hierarchy (required)
    --seed <N>                     Seed for names and pool selection [default: 42]
    --competitors-min <N>          Minimum skaters per event [default: 8]
    --competitors-max <N>          Maximum skaters per event [default: 14]
    --multi-event-2-weight <0-1>   Fraction of roster in exactly 2 events [default: 0.30]
    --multi-event-3-weight <0-1>   Fraction of roster in exactly 3 events [default: 0.20]
    --min-duration-secs <N>        Minimum pool track length in seconds (exclusive) [default: 60]
    --dry-run                      Print planned tracks without writing files
    -h, --help                     Show this help

EXAMPLE:
    cargo run --manifest-path src-tauri/Cargo.toml --bin generate-demo-dataset -- \
        --schedule "D:\meets\event-schedule.xlsx" \
        --output "D:\drops\demo-meet" \
        --track-pool "D:\Music\pool"
"#
    );
}

fn parse_args() -> Result<GenerateDemoOptions, String> {
    let args: Vec<String> = env::args().skip(1).collect();
    if args.is_empty() || args.iter().any(|a| a == "-h" || a == "--help") {
        print_help();
        return Err("help".to_string());
    }

    let mut schedule_path: Option<PathBuf> = None;
    let mut output_dir: Option<PathBuf> = None;
    let mut track_pool_dir: Option<PathBuf> = None;
    let mut seed = DEFAULT_SEED;
    let mut competitors_min = DEFAULT_COMPETITORS_MIN;
    let mut competitors_max = DEFAULT_COMPETITORS_MAX;
    let mut multi_event_2_weight = DEFAULT_MULTI_EVENT_2_WEIGHT;
    let mut multi_event_3_weight = DEFAULT_MULTI_EVENT_3_WEIGHT;
    let mut min_duration_ms = MIN_POOL_TRACK_DURATION_MS;
    let mut dry_run = false;

    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--schedule" => {
                i += 1;
                schedule_path = Some(PathBuf::from(require_value(&args, i, "--schedule")?));
            }
            "--output" => {
                i += 1;
                output_dir = Some(PathBuf::from(require_value(&args, i, "--output")?));
            }
            "--track-pool" => {
                i += 1;
                track_pool_dir = Some(PathBuf::from(require_value(&args, i, "--track-pool")?));
            }
            "--seed" => {
                i += 1;
                let raw = require_value(&args, i, "--seed")?;
                seed = raw
                    .parse()
                    .map_err(|_| format!("Invalid --seed value: {raw}"))?;
            }
            "--competitors-min" => {
                i += 1;
                let raw = require_value(&args, i, "--competitors-min")?;
                competitors_min = raw
                    .parse()
                    .map_err(|_| format!("Invalid --competitors-min value: {raw}"))?;
            }
            "--competitors-max" => {
                i += 1;
                let raw = require_value(&args, i, "--competitors-max")?;
                competitors_max = raw
                    .parse()
                    .map_err(|_| format!("Invalid --competitors-max value: {raw}"))?;
            }
            "--multi-event-2-weight" => {
                i += 1;
                let raw = require_value(&args, i, "--multi-event-2-weight")?;
                multi_event_2_weight = raw
                    .parse()
                    .map_err(|_| format!("Invalid --multi-event-2-weight value: {raw}"))?;
            }
            "--multi-event-3-weight" => {
                i += 1;
                let raw = require_value(&args, i, "--multi-event-3-weight")?;
                multi_event_3_weight = raw
                    .parse()
                    .map_err(|_| format!("Invalid --multi-event-3-weight value: {raw}"))?;
            }
            "--min-duration-secs" => {
                i += 1;
                let raw = require_value(&args, i, "--min-duration-secs")?;
                let secs: u64 = raw
                    .parse()
                    .map_err(|_| format!("Invalid --min-duration-secs value: {raw}"))?;
                min_duration_ms = (secs as i64).saturating_mul(1000);
            }
            "--dry-run" => dry_run = true,
            flag => return Err(format!("Unknown argument: {flag}")),
        }
        i += 1;
    }

    Ok(GenerateDemoOptions {
        schedule_path: schedule_path.ok_or_else(|| "--schedule is required".to_string())?,
        output_dir: output_dir.ok_or_else(|| "--output is required".to_string())?,
        track_pool_dir: track_pool_dir.ok_or_else(|| "--track-pool is required".to_string())?,
        seed,
        competitors_min,
        competitors_max,
        multi_event_2_weight,
        multi_event_3_weight,
        min_duration_ms,
        dry_run,
    })
}

fn require_value(args: &[String], index: usize, flag: &str) -> Result<String, String> {
    args.get(index)
        .cloned()
        .ok_or_else(|| format!("Missing value for {flag}"))
}

fn main() -> ExitCode {
    let opts = match parse_args() {
        Ok(opts) => opts,
        Err(e) if e == "help" => return ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("Error: {e}");
            eprintln!("Run with --help for usage.");
            return ExitCode::from(2);
        }
    };

    match generate_demo_dataset(opts) {
        Ok(report) => {
            for line in &report.lines {
                eprintln!("{line}");
            }
            for warning in &report.warnings {
                eprintln!("Warning: {warning}");
            }
            if report.lines.is_empty() {
                eprintln!(
                    "Done: {} tracks written, {} unique skaters",
                    report.tracks_written, report.unique_skaters
                );
                if let Some(dest) = &report.schedule_dest {
                    eprintln!("Schedule: {}", dest.display());
                }
            } else {
                eprintln!(
                    "Dry run: {} tracks planned, {} unique skaters",
                    report.tracks_planned, report.unique_skaters
                );
            }
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("Failed: {e}");
            ExitCode::from(1)
        }
    }
}
