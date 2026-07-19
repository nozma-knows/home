use tauri::{
    Emitter, Manager,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_shell::{ShellExt, process::CommandChild};

struct SidecarState(std::sync::Mutex<Option<CommandChild>>);

#[tauri::command]
fn start_sidecar(
    app: tauri::AppHandle,
    state: tauri::State<'_, SidecarState>,
    token: String,
    socket_url: String,
) -> Result<(), String> {
    let mut child_state = state.0.lock().map_err(|error| error.to_string())?;
    if child_state.is_some() {
        return Ok(());
    }
    let (mut events, child) = app
        .shell()
        .sidecar("home-sidecar")
        .map_err(|error| error.to_string())?
        .args(["--socket-url", &socket_url, "--token", &token])
        .spawn()
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn(async move {
        while let Some(event) = events.recv().await {
            match event {
                tauri_plugin_shell::process::CommandEvent::Stdout(line) => {
                    println!("sidecar: {}", String::from_utf8_lossy(&line));
                }
                tauri_plugin_shell::process::CommandEvent::Stderr(line) => {
                    eprintln!("sidecar: {}", String::from_utf8_lossy(&line));
                }
                _ => {}
            }
        }
    });
    *child_state = Some(child);
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(SidecarState(std::sync::Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![start_sidecar])
        .setup(|app| {
            let show = MenuItem::with_id(app, "show", "Show home", true, None::<&str>)?;
            let push_to_talk =
                MenuItem::with_id(app, "push_to_talk", "Push to talk", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &push_to_talk, &quit])?;
            let mut tray = TrayIconBuilder::new()
                .tooltip("home")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "push_to_talk" => {
                        let _ = app.emit("home://push-to-talk", ());
                    }
                    "quit" => app.exit(0),
                    _ => {}
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            let shortcut = Shortcut::new(Some(Modifiers::ALT), Code::Space);
            app.global_shortcut().on_shortcut(shortcut, |app, _, event| {
                if event.state() == ShortcutState::Pressed {
                    let _ = app.emit("home://push-to-talk", ());
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            })?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running home desktop");
}
