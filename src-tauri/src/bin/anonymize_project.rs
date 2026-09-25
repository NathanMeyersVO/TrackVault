use std::env;
use std::path::PathBuf;
use std::process::ExitCode;

use trackvault_lib::anonymize::{
    anonymize_project, AnonymizeOptions, DEFAULT_OUTPUT_SUBDIR, DEFAULT_SEED,
};

fn print_help() {
    eprintln!(
        r#"anonymize-project — copy project audio with skater names replaced by fake names

PII is taken from the Track Title tag (skater name). Copies are written under a
subfolder of the project root; filename stems and Track Title tags are updated.
Original files are not modified.

USAGE:
    anonymize-project --project-dir <PATH> [OPTIONS]

OPTIONS:
    --project-dir <PATH>           Project root folder to scan (required)
    --output-subdir <NAME>     Output subfolder under project root [default: DEMO_COPY]
    --seed <N>                 Seed for reproducible fake names [default: 42]
    --dry-run                  Print planned copies without writing files
    --strict                   Exit with error if any file cannot be processed
    -h, --help                 Show this help

EXAMPLE:
    cargo run --manifest-path src-tauri/Cargo.toml --bin anonymize-project -- \
        --project-dir "D:\Music\MyLibrary"
"#
    );
}

fn parse_args() -> Result<AnonymizeOptions, String> {
    let args: Vec<String> = env::args().skip(1).collect();
    if args.is_empty() || args.iter().any(|a| a == "-h" || a == "--help") {
        print_help();
        return Err("help".to_string());
    }

    let mut library_root: Option<PathBuf> = None;
    let mut output_subdir = DEFAULT_OUTPUT_SUBDIR.to_string();
    let mut seed = DEFAULT_SEED;
    let mut dry_run = false;
    let mut strict = false;

    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--project-dir" => {
                i += 1;
                library_root = Some(PathBuf::from(require_value(&args, i, "--project-dir")?));
            }
            "--output-subdir" => {
                i += 1;
                output_subdir = require_value(&args, i, "--output-subdir")?;
            }
            "--seed" => {
                i += 1;
                let raw = require_value(&args, i, "--seed")?;
                seed = raw
                    .parse()
                    .map_err(|_| format!("Invalid --seed value: {raw}"))?;
            }
            "--dry-run" => dry_run = true,
            "--strict" => strict = true,
            flag => return Err(format!("Unknown argument: {flag}")),
        }
        i += 1;
    }

    let library_root =
        library_root.ok_or_else(|| "--project-dir is required".to_string())?;

    if output_subdir.is_empty() || output_subdir.contains('/') || output_subdir.contains('\\') {
        return Err("--output-subdir must be a single folder name".to_string());
    }

    Ok(AnonymizeOptions {
        library_root,
        output_subdir,
        seed,
        dry_run,
        strict,
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

    match anonymize_project(opts) {
        Ok(report) => {
            eprintln!(
                "Done: {} copied, {} skipped, {} errors",
                report.copied,
                report.skipped,
                report.errors.len()
            );
            for warning in &report.warnings {
                eprintln!("Warning: {warning}");
            }
            for error in &report.errors {
                eprintln!("Error: {error}");
            }
            if !report.errors.is_empty() {
                return ExitCode::from(1);
            }
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("Failed: {e}");
            ExitCode::from(1)
        }
    }
}
