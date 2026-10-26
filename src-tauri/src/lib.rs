mod commands;
mod models;

use specta_typescript::semantic;
use tauri_specta::{collect_commands, Builder};

/// Hier staan alle commands die de frontend mag aanroepen.
/// Zowel `invoke_handler` als `bindings.ts` worden hieruit gemaakt, dus ze lopen nooit uit elkaar.
fn specta_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new()
        .commands(collect_commands![
            commands::list_boards,
            commands::load_board,
            commands::save_board,
            commands::delete_board,
            commands::auto_layout,
            commands::export_board,
        ])
        // Eén TS-type per struct in plaats van aparte `Board_Serialize` / `Board_Deserialize`.
        .disable_serde_phases()
        // f64 wordt standaard `number | null`, omdat serde_json NaN/Infinity als null schrijft.
        // Wij sturen nooit NaN, dus gewoon `number`.
        .semantic_types(semantic::Configuration::empty().enable_lossless_floats())
}

/// Schrijft de TypeScript-bindings naar `src/bindings.ts`.
fn export_bindings(builder: &Builder<tauri::Wry>) {
    builder
        .export(
            specta_typescript::Typescript::default()
                .header("// @ts-nocheck\n// Gegenereerd door tauri-specta. Niet met de hand aanpassen, wijzig de Rust-code."),
            concat!(env!("CARGO_MANIFEST_DIR"), "/../src/bindings.ts"),
        )
        .expect("kon src/bindings.ts niet schrijven");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = specta_builder();

    // Alleen in dev-builds: bij elke `npm run tauri dev` worden de types ververst.
    #[cfg(debug_assertions)]
    export_bindings(&builder);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(builder.invoke_handler())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    /// `cargo test` genereert de bindings ook, zonder de app te starten.
    #[test]
    fn export_bindings() {
        super::export_bindings(&super::specta_builder());
    }
}
