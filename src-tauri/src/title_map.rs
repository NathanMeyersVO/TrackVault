use std::collections::HashMap;
use std::path::{Path, PathBuf};

use calamine::{open_workbook_auto, Data, Reader};

const EVENT_SCHEDULE_SHEET: &str = "Event Schedule";
const TAG_COLUMN: &str = "#";
const TITLE_COLUMN: &str = "Title";
const GROUP_COLUMN: &str = "Group";

fn is_excel_extension(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase()),
        Some(ext) if ext == "xls" || ext == "xlsx"
    )
}

pub fn find_top_level_event_schedule(
    library_root: &Path,
) -> Result<Option<(PathBuf, HashMap<String, String>)>, String> {
    let candidates: Vec<PathBuf> = std::fs::read_dir(library_root)
        .map_err(|e| e.to_string())?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| path.is_file() && is_excel_extension(path))
        .collect();

    if candidates.len() != 1 {
        return Ok(None);
    }

    let path = candidates.into_iter().next().expect("exactly one candidate");
    match parse_usfs_ems_schedule(&path) {
        Ok(mappings) => Ok(Some((path, mappings))),
        Err(_) => Ok(None),
    }
}

pub fn parse_usfs_ems_schedule(path: &Path) -> Result<HashMap<String, String>, String> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    match ext.as_str() {
        "csv" => parse_csv(path),
        "xls" | "xlsx" => parse_excel(path),
        _ => Err(format!("Unsupported file type: .{ext}")),
    }
}

fn parse_excel(path: &Path) -> Result<HashMap<String, String>, String> {
    let mut workbook = match open_workbook_auto(path) {
        Ok(wb) => wb,
        Err(e) => {
            let msg = e.to_string();
            let wrong_xlsx_ext = path
                .extension()
                .and_then(|x| x.to_str())
                .is_some_and(|x| x.eq_ignore_ascii_case("xlsx"));
            if wrong_xlsx_ext && (msg.contains("Zip") || msg.contains("EOCD")) {
                return Err(format!(
                    "File looks like legacy Excel (.xls) but is named .xlsx: {}",
                    path.display()
                ));
            }
            return Err(msg);
        }
    };
    let range = workbook
        .worksheet_range(EVENT_SCHEDULE_SHEET)
        .map_err(|e| format!("Failed to read sheet \"{EVENT_SCHEDULE_SHEET}\": {e}"))?;

    let mut rows = range.rows();
    let header = rows
        .next()
        .ok_or_else(|| format!("Sheet \"{EVENT_SCHEDULE_SHEET}\" is empty"))?;
    let header_cells: Vec<String> = header.iter().map(cell_to_string).collect();
    let data_rows: Vec<Vec<String>> = rows
        .map(|row| row.iter().map(cell_to_string).collect())
        .collect();

    parse_title_map_from_rows(&header_cells, &data_rows)
}

fn parse_csv(path: &Path) -> Result<HashMap<String, String>, String> {
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(true)
        .from_path(path)
        .map_err(|e| e.to_string())?;

    let headers: Vec<String> = reader
        .headers()
        .map_err(|e| e.to_string())?
        .iter()
        .map(|header| header.trim().to_string())
        .collect();

    let data_rows: Vec<Vec<String>> = reader
        .records()
        .filter_map(|record| record.ok())
        .map(|record| {
            record
                .iter()
                .map(|field| field.trim().to_string())
                .collect()
        })
        .collect();

    parse_title_map_from_rows(&headers, &data_rows)
}

fn parse_title_map_from_rows(
    headers: &[String],
    rows: &[Vec<String>],
) -> Result<HashMap<String, String>, String> {
    let tag_idx = headers
        .iter()
        .position(|header| header.trim() == TAG_COLUMN)
        .ok_or_else(|| format!("Missing \"{TAG_COLUMN}\" column"))?;
    let title_idx = headers
        .iter()
        .position(|header| header.trim() == TITLE_COLUMN)
        .ok_or_else(|| format!("Missing \"{TITLE_COLUMN}\" column"))?;
    let group_idx = headers
        .iter()
        .position(|header| header.trim() == GROUP_COLUMN);

    let mut map = HashMap::new();
    for row in rows {
        let tag = row.get(tag_idx).map(|s| s.trim()).unwrap_or("");
        let title = row.get(title_idx).map(|s| s.trim()).unwrap_or("");
        if tag.is_empty() || title.is_empty() {
            continue;
        }
        let display_title = match group_idx
            .and_then(|idx| row.get(idx).map(|s| s.trim()))
            .filter(|group| !group.is_empty())
        {
            Some(group) => format!("{title} {group}"),
            None => title.to_string(),
        };
        map.insert(tag.to_string(), display_title);
    }

    if map.is_empty() {
        return Err("No title mappings found".to_string());
    }

    Ok(map)
}

fn cell_to_string(cell: &Data) -> String {
    match cell {
        Data::Empty => String::new(),
        Data::String(value) => value.trim().to_string(),
        Data::Float(value) => {
            if value.fract() == 0.0 {
                format!("{value:.0}")
            } else {
                value.to_string()
            }
        }
        Data::Int(value) => value.to_string(),
        Data::Bool(value) => value.to_string(),
        Data::DateTime(value) => value.to_string(),
        Data::DateTimeIso(value) => value.trim().to_string(),
        Data::DurationIso(value) => value.trim().to_string(),
        Data::Error(_) => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_title_map_from_schedule_headers() {
        let headers = vec![
            "Facility".to_string(),
            "Ice Sheet".to_string(),
            "Date".to_string(),
            "Start Time".to_string(),
            "End Time".to_string(),
            "Time".to_string(),
            "#".to_string(),
            "Title".to_string(),
            "Group".to_string(),
        ];
        let rows = vec![vec![
            "UTC Ice Sports Center".to_string(),
            "Sheet 1".to_string(),
            "08/22/2026".to_string(),
            "11:00 AM".to_string(),
            "11:16 AM".to_string(),
            "11:00 AM - 11:16 AM".to_string(),
            "01".to_string(),
            "Showcase: Pre-Preliminary ".to_string(),
            "".to_string(),
        ]];

        let map = parse_title_map_from_rows(&headers, &rows).unwrap();
        assert_eq!(
            map.get("01"),
            Some(&"Showcase: Pre-Preliminary".to_string())
        );
    }

    #[test]
    fn appends_group_to_title_when_present() {
        let headers = vec![
            "#".to_string(),
            "Title".to_string(),
            "Group".to_string(),
        ];
        let rows = vec![vec![
            "01".to_string(),
            "Showcase: Pre-Preliminary".to_string(),
            "F".to_string(),
        ]];

        let map = parse_title_map_from_rows(&headers, &rows).unwrap();
        assert_eq!(
            map.get("01"),
            Some(&"Showcase: Pre-Preliminary F".to_string())
        );
    }

    #[test]
    fn title_unchanged_when_group_column_missing() {
        let headers = vec!["#".to_string(), "Title".to_string()];
        let rows = vec![vec![
            "01".to_string(),
            "Showcase: Pre-Preliminary".to_string(),
        ]];

        let map = parse_title_map_from_rows(&headers, &rows).unwrap();
        assert_eq!(
            map.get("01"),
            Some(&"Showcase: Pre-Preliminary".to_string())
        );
    }

    #[test]
    fn duplicate_tags_last_row_wins() {
        let headers = vec!["#".to_string(), "Title".to_string()];
        let rows = vec![
            vec!["01".to_string(), "First".to_string()],
            vec!["01".to_string(), "Second".to_string()],
        ];

        let map = parse_title_map_from_rows(&headers, &rows).unwrap();
        assert_eq!(map.get("01"), Some(&"Second".to_string()));
    }

    #[test]
    fn missing_hash_column_errors() {
        let headers = vec!["Title".to_string()];
        let rows = vec![vec!["Only title".to_string()]];

        let err = parse_title_map_from_rows(&headers, &rows).unwrap_err();
        assert!(err.contains("#"));
    }

    fn write_event_schedule_xlsx(path: &Path, rows: &[(&str, &str)]) {
        use rust_xlsxwriter::{Workbook, Worksheet};

        let mut workbook = Workbook::new();
        let mut worksheet = Worksheet::new();
        worksheet.set_name("Event Schedule").unwrap();
        worksheet.write_string(0, 0, "#").unwrap();
        worksheet.write_string(0, 1, "Title").unwrap();
        for (row_idx, (tag, title)) in rows.iter().enumerate() {
            let row = (row_idx + 1) as u32;
            worksheet.write_string(row, 0, *tag).unwrap();
            worksheet.write_string(row, 1, *title).unwrap();
        }
        workbook.push_worksheet(worksheet);
        workbook.save(path).unwrap();
    }

    fn temp_library_dir() -> PathBuf {
        use std::sync::atomic::{AtomicU64, Ordering};

        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let unique = COUNTER.fetch_add(1, Ordering::Relaxed);
        let library = std::env::temp_dir().join(format!(
            "trackvault-title-map-test-{}-{unique}",
            std::process::id()
        ));
        std::fs::create_dir_all(&library).expect("create library dir");
        library
    }

    #[test]
    fn find_top_level_event_schedule_none_when_no_excel_files() {
        let library = temp_library_dir();
        let result = find_top_level_event_schedule(&library).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn find_top_level_event_schedule_none_when_multiple_excel_files() {
        let library = temp_library_dir();
        write_event_schedule_xlsx(&library.join("a.xlsx"), &[("01", "First")]);
        write_event_schedule_xlsx(&library.join("b.xlsx"), &[("02", "Second")]);

        let result = find_top_level_event_schedule(&library).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn find_top_level_event_schedule_none_when_schedule_invalid() {
        let library = temp_library_dir();
        std::fs::write(library.join("schedule.xlsx"), b"not an xlsx").unwrap();

        let result = find_top_level_event_schedule(&library).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn find_top_level_event_schedule_returns_mappings_for_single_valid_file() {
        let library = temp_library_dir();
        let path = library.join("schedule.xlsx");
        write_event_schedule_xlsx(&path, &[("01", "Showcase: Pre-Preliminary")]);

        let result = find_top_level_event_schedule(&library).unwrap();
        let (found_path, mappings) = result.expect("expected schedule");
        assert_eq!(found_path, path);
        assert_eq!(
            mappings.get("01"),
            Some(&"Showcase: Pre-Preliminary".to_string())
        );
    }
}
