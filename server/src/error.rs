//! Errors as responses: `{ "error": "message" }` with a fitting status code.

use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};

#[derive(Debug)]
pub struct AppError {
    pub status: StatusCode,
    pub message: String,
}

pub type ApiResult<T> = Result<T, AppError>;

impl AppError {
    pub fn new(status: StatusCode, message: impl Into<String>) -> AppError {
        AppError { status, message: message.into() }
    }
    pub fn bad(message: impl Into<String>) -> AppError {
        AppError::new(StatusCode::BAD_REQUEST, message)
    }
    pub fn unauthorized() -> AppError {
        AppError::new(StatusCode::UNAUTHORIZED, "Log in first")
    }
    pub fn forbidden(message: impl Into<String>) -> AppError {
        AppError::new(StatusCode::FORBIDDEN, message)
    }
    pub fn not_found(what: &str) -> AppError {
        AppError::new(StatusCode::NOT_FOUND, format!("{what} not found"))
    }
    pub fn conflict(message: impl Into<String>) -> AppError {
        AppError::new(StatusCode::CONFLICT, message)
    }
    pub fn internal(e: impl std::fmt::Display) -> AppError {
        tracing::error!("{e}");
        AppError::new(StatusCode::INTERNAL_SERVER_ERROR, "Something went wrong on the server")
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        (self.status, Json(serde_json::json!({ "error": self.message }))).into_response()
    }
}

impl From<sqlx::Error> for AppError {
    fn from(e: sqlx::Error) -> AppError {
        match e {
            sqlx::Error::RowNotFound => AppError::not_found("It was"),
            e => AppError::internal(e),
        }
    }
}

/// Errors from `flow_core` (a folder that does not exist, an empty name, ...)
impl From<String> for AppError {
    fn from(message: String) -> AppError {
        AppError::bad(message)
    }
}
