use flow_server::{AppState, config::Config, routes};

#[tokio::main]
async fn main() {
    // Only server/.env (where the server runs): not a .env further up, such as the
    // one next to docker-compose.yml, which is for Docker
    let _ = dotenvy::from_path(".env");
    tracing_subscriber::fmt().with_env_filter(std::env::var("RUST_LOG").unwrap_or_else(|_| "info,flow_server=debug".into())).init();
    let config = Config::from_env().unwrap_or_else(|e| panic!("configuration: {e}"));
    let state = AppState::connect(config).await.unwrap_or_else(|e| panic!("starting: {e}"));
    let bind = state.config.bind.clone();
    let listener = tokio::net::TcpListener::bind(&bind).await.unwrap_or_else(|e| panic!("cannot listen on {bind}: {e}"));
    tracing::info!("Flow server on {bind}, public at {}", state.config.public_url);
    tracing::info!("Mail: {}", state.mailer.describe());
    match &state.config.google {
        Some(_) => tracing::info!("Google sign-in: on (redirect URI {}/api/auth/google/callback)", state.config.public_url),
        None => tracing::info!("Google sign-in: off (set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET)"),
    }
    // Empty what has been in the trash for longer than 30 days, every hour
    let purge = state.clone();
    tokio::spawn(async move {
        let mut every = tokio::time::interval(std::time::Duration::from_secs(3600));
        loop {
            every.tick().await;
            if let Err(e) = routes::trash::purge(&purge).await {
                tracing::warn!("emptying the trash: {e}");
            }
        }
    });
    axum::serve(listener, routes::app(state)).await.expect("server stopped");
}
