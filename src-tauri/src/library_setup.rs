use std::path::Path;

use crate::application::ApplicationId;
use crate::db::Database;
use crate::title_map;

const EVENTS_TAGLIST_NAME: &str = "Events";
const EVENTS_TAG_KEY: &str = "Composer";
const EVENTS_ENTRY_TAG_KEY: &str = "Track Title";
const EVENTS_VALUE_SINGULAR_NAME: &str = "Event";

pub fn apply_application_library_setup(
    db: &Database,
    library_root: &Path,
    application: ApplicationId,
) -> Result<(), String> {
    apply_application_library_setup_with_schedule(db, library_root, application, None)
}

pub fn apply_application_library_setup_with_schedule(
    db: &Database,
    library_root: &Path,
    application: ApplicationId,
    schedule_path: Option<&Path>,
) -> Result<(), String> {
    match application {
        ApplicationId::None => Ok(()),
        ApplicationId::UsFigureSkatingEms => {
            setup_usfs_ems(db, library_root, schedule_path)
        }
    }
}

fn setup_usfs_ems(
    db: &Database,
    library_root: &Path,
    schedule_path: Option<&Path>,
) -> Result<(), String> {
    let taglist_id = ensure_events_taglist(db)?;

    let mappings = if let Some(path) = schedule_path {
        if path.is_file() {
            Some(crate::application::parse_title_map_for_application(
                ApplicationId::UsFigureSkatingEms,
                path,
            )?)
        } else {
            None
        }
    } else if let Some((_path, mappings)) = title_map::find_top_level_event_schedule(library_root)? {
        Some(mappings)
    } else {
        None
    };

    if let Some(mappings) = mappings {
        db.import_taglist_titles(taglist_id, &mappings)
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn ensure_events_taglist(db: &Database) -> Result<i64, String> {
    if let Some(taglist) = db
        .get_taglist_by_name(EVENTS_TAGLIST_NAME)
        .map_err(|e| e.to_string())?
    {
        if taglist.value_singular_name.trim().is_empty() {
            db.set_taglist_value_singular_name(taglist.id, EVENTS_VALUE_SINGULAR_NAME)
                .map_err(|e| e.to_string())?;
        }
        if taglist.entry_tag_key.trim().is_empty() {
            db.set_taglist_entry_tag_key(taglist.id, EVENTS_ENTRY_TAG_KEY)
                .map_err(|e| e.to_string())?;
        }
        return Ok(taglist.id);
    }

    db.create_taglist(
        EVENTS_TAGLIST_NAME,
        EVENTS_TAG_KEY,
        EVENTS_ENTRY_TAG_KEY,
        EVENTS_VALUE_SINGULAR_NAME,
    )
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::application::ApplicationId;
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
    fn none_application_does_not_create_taglist_even_with_xls() {
        let (db, library) = test_library();
        write_event_schedule_xlsx(
            &library.join("schedule.xlsx"),
            &[("01", "Showcase: Pre-Preliminary")],
        );

        apply_application_library_setup(&db, &library, ApplicationId::None).unwrap();

        assert!(db.list_taglists().unwrap().is_empty());
    }

    #[test]
    fn ems_creates_events_taglist_without_xls() {
        let (db, library) = test_library();

        apply_application_library_setup(&db, &library, ApplicationId::UsFigureSkatingEms).unwrap();

        let taglists = db.list_taglists().unwrap();
        assert_eq!(taglists.len(), 1);
        assert_eq!(taglists[0].name, "Events");
        assert_eq!(taglists[0].tag_key, "Composer");
        assert_eq!(taglists[0].entry_tag_key, "Track Title");
        assert_eq!(taglists[0].value_singular_name, "Event");
    }

    #[test]
    fn ems_imports_xls_when_present() {
        let (db, library) = test_library();
        write_event_schedule_xlsx(
            &library.join("schedule.xlsx"),
            &[("01", "Showcase: Pre-Preliminary")],
        );

        apply_application_library_setup(&db, &library, ApplicationId::UsFigureSkatingEms).unwrap();

        let taglists = db.list_taglists().unwrap();
        assert_eq!(taglists.len(), 1);
        assert_eq!(taglists[0].name, "Events");
        assert_eq!(taglists[0].tag_key, "Composer");
        assert_eq!(taglists[0].entry_tag_key, "Track Title");
        assert_eq!(taglists[0].value_singular_name, "Event");

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
    fn ems_reuses_existing_events_taglist_and_imports_xls() {
        let (db, library) = test_library();
        db.create_taglist("Events", "Comment", "", "").unwrap();
        write_event_schedule_xlsx(
            &library.join("schedule.xlsx"),
            &[("01", "Showcase: Pre-Preliminary")],
        );

        apply_application_library_setup(&db, &library, ApplicationId::UsFigureSkatingEms).unwrap();

        let taglists = db.list_taglists().unwrap();
        assert_eq!(taglists.len(), 1);
        assert_eq!(taglists[0].tag_key, "Comment");
        assert_eq!(taglists[0].value_singular_name, "Event");
    }

    #[test]
    fn ems_creates_taglist_when_multiple_excel_files_present() {
        let (db, library) = test_library();
        write_event_schedule_xlsx(&library.join("a.xlsx"), &[("01", "First")]);
        write_event_schedule_xlsx(&library.join("b.xlsx"), &[("02", "Second")]);

        apply_application_library_setup(&db, &library, ApplicationId::UsFigureSkatingEms).unwrap();

        let taglists = db.list_taglists().unwrap();
        assert_eq!(taglists.len(), 1);
        assert_eq!(taglists[0].name, "Events");
    }

    #[test]
    fn ems_creates_taglist_when_schedule_is_invalid() {
        let (db, library) = test_library();
        write_invalid_sheet_xlsx(&library.join("schedule.xlsx"));

        apply_application_library_setup(&db, &library, ApplicationId::UsFigureSkatingEms).unwrap();

        let taglists = db.list_taglists().unwrap();
        assert_eq!(taglists.len(), 1);
        assert_eq!(taglists[0].name, "Events");
    }
}
