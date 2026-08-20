use std::path::Path;

use crate::db::Database;
use crate::title_map;

const EVENTS_TAGLIST_NAME: &str = "Events";
const EVENTS_TAG_KEY: &str = "Composer";

pub fn maybe_auto_import_event_schedule(
    db: &Database,
    library_root: &Path,
) -> Result<(), String> {
    if db
        .has_taglist_named(EVENTS_TAGLIST_NAME)
        .map_err(|e| e.to_string())?
    {
        return Ok(());
    }

    let Some((_path, mappings)) = title_map::find_top_level_event_schedule(library_root)? else {
        return Ok(());
    };

    let taglist_id = db
        .create_taglist(EVENTS_TAGLIST_NAME, EVENTS_TAG_KEY)
        .map_err(|e| e.to_string())?;
    db.import_taglist_titles(taglist_id, &mappings)
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;

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

    fn write_invalid_sheet_xlsx(path: &Path) {
        use rust_xlsxwriter::{Workbook, Worksheet};

        let mut workbook = Workbook::new();
        let mut worksheet = Worksheet::new();
        worksheet.set_name("Other Sheet").unwrap();
        worksheet.write_string(0, 0, "#").unwrap();
        worksheet.write_string(0, 1, "Title").unwrap();
        workbook.push_worksheet(worksheet);
        workbook.save(path).unwrap();
    }

    fn test_library() -> (Database, std::path::PathBuf) {
        use std::sync::atomic::{AtomicU64, Ordering};

        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let unique = COUNTER.fetch_add(1, Ordering::Relaxed);
        let db = Database::open(std::path::Path::new(":memory:")).expect("in-memory db");
        let library = std::env::temp_dir().join(format!(
            "trackvault-events-test-{}-{unique}",
            std::process::id()
        ));
        std::fs::create_dir_all(&library).expect("create library dir");
        let library = library.canonicalize().unwrap_or(library);
        db.set_library_folder(library.to_str().unwrap())
            .expect("set library");
        (db, library)
    }

    #[test]
    fn auto_import_creates_events_taglist_with_composer_key() {
        let (db, library) = test_library();
        write_event_schedule_xlsx(
            &library.join("schedule.xlsx"),
            &[("01", "Showcase: Pre-Preliminary")],
        );

        maybe_auto_import_event_schedule(&db, &library).unwrap();

        let taglists = db.list_taglists().unwrap();
        assert_eq!(taglists.len(), 1);
        assert_eq!(taglists[0].name, "Events");
        assert_eq!(taglists[0].tag_key, "Composer");

        let (track_id, _) = db
            .upsert_track(
                library.join("01-track.mp3").to_str().unwrap(),
                "Track",
                "Artist",
                "Album",
                1000,
                None,
            )
            .unwrap();
        db.replace_track_tags(
            track_id,
            &[("Composer".to_string(), "01".to_string())],
        )
        .unwrap();

        let values = db.list_taglist_values("Composer", taglists[0].id).unwrap();
        let tagged = values.iter().find(|v| v.value.as_deref() == Some("01"));
        assert!(tagged.is_some());
        assert_eq!(
            tagged.unwrap().display_title.as_deref(),
            Some("Showcase: Pre-Preliminary")
        );
    }

    #[test]
    fn auto_import_skips_when_events_taglist_already_exists() {
        let (db, library) = test_library();
        db.create_taglist("Events", "Comment").unwrap();
        write_event_schedule_xlsx(
            &library.join("schedule.xlsx"),
            &[("01", "Showcase: Pre-Preliminary")],
        );

        maybe_auto_import_event_schedule(&db, &library).unwrap();

        let taglists = db.list_taglists().unwrap();
        assert_eq!(taglists.len(), 1);
        assert_eq!(taglists[0].tag_key, "Comment");
    }

    #[test]
    fn auto_import_skips_when_multiple_excel_files_present() {
        let (db, library) = test_library();
        write_event_schedule_xlsx(&library.join("a.xlsx"), &[("01", "First")]);
        write_event_schedule_xlsx(&library.join("b.xlsx"), &[("02", "Second")]);

        maybe_auto_import_event_schedule(&db, &library).unwrap();

        assert!(db.list_taglists().unwrap().is_empty());
    }

    #[test]
    fn auto_import_skips_when_schedule_is_invalid() {
        let (db, library) = test_library();
        write_invalid_sheet_xlsx(&library.join("schedule.xlsx"));

        maybe_auto_import_event_schedule(&db, &library).unwrap();

        assert!(db.list_taglists().unwrap().is_empty());
    }
}
