//! Sending mail: over SMTP when configured, else to `MAIL_OUTBOX` (one JSON file
//! per mail, for development and end-to-end tests), else only to the log.
//! Tests use `Mailer::Memory` and read what was sent.

use std::path::PathBuf;
use std::sync::Mutex;

use lettre::message::Mailbox;
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};
use serde::Serialize;

use crate::config::Config;

#[derive(Debug, Clone, Serialize)]
pub struct Mail {
    pub to: String,
    pub subject: String,
    pub text: String,
}

pub enum Mailer {
    Smtp { transport: AsyncSmtpTransport<Tokio1Executor>, from: Mailbox },
    Outbox(PathBuf),
    Log,
    Memory(Mutex<Vec<Mail>>),
}

/// Sends a mail without making the request wait for the mail server: a notice
/// is not worth a slow answer. Other mailers (files, the log, tests) at once.
pub async fn send_later(mailer: &std::sync::Arc<Mailer>, mail: Mail) {
    if matches!(**mailer, Mailer::Smtp { .. }) {
        let m = mailer.clone();
        tokio::spawn(async move { m.send(mail).await });
    } else {
        mailer.send(mail).await;
    }
}

impl Mailer {
    pub fn from_config(c: &Config) -> Result<Mailer, String> {
        if let Some(s) = &c.smtp {
            let from: Mailbox = c.mail_from.parse().map_err(|e| format!("MAIL_FROM: {e}"))?;
            // Port 465 talks TLS from the start; 587 (and others) upgrade with STARTTLS
            let builder = if s.port == 465 {
                AsyncSmtpTransport::<Tokio1Executor>::relay(&s.host)
            } else {
                AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&s.host)
            };
            let transport = builder
                .map_err(|e| format!("SMTP_HOST: {e}"))?
                .port(s.port)
                .credentials(Credentials::new(s.user.clone(), s.password.clone()))
                .build();
            return Ok(Mailer::Smtp { transport, from });
        }
        if let Some(dir) = &c.mail_outbox {
            std::fs::create_dir_all(dir).map_err(|e| format!("MAIL_OUTBOX: {e}"))?;
            return Ok(Mailer::Outbox(dir.clone()));
        }
        Ok(Mailer::Log)
    }

    /// Sends a mail. A failure is logged, not returned: the action that sent it
    /// (an invite, a sign-up) has already happened and can send it again.
    pub async fn send(&self, mail: Mail) {
        let result: Result<(), String> = match self {
            Mailer::Smtp { transport, from } => async {
                let to: Mailbox = mail.to.parse().map_err(|e| format!("{e}"))?;
                let msg = Message::builder().from(from.clone()).to(to).subject(&mail.subject).body(mail.text.clone()).map_err(|e| e.to_string())?;
                transport.send(msg).await.map(|_| ()).map_err(|e| e.to_string())
            }
            .await,
            Mailer::Outbox(dir) => {
                let name = format!("{}-{}.json", chrono::Utc::now().timestamp_millis(), crate::tokens::short_token());
                std::fs::write(dir.join(name), serde_json::to_string_pretty(&mail).unwrap_or_default()).map_err(|e| e.to_string())
            }
            Mailer::Log => {
                tracing::info!("mail to {}: {}\n{}", mail.to, mail.subject, mail.text);
                Ok(())
            }
            Mailer::Memory(sent) => {
                sent.lock().unwrap().push(mail.clone());
                Ok(())
            }
        };
        if let Err(e) = result {
            tracing::error!("cannot send mail to {}: {e}", mail.to);
        }
    }

    /// How mail goes out, for the log at startup
    pub fn describe(&self) -> String {
        match self {
            Mailer::Smtp { .. } => "sent over SMTP".into(),
            Mailer::Outbox(dir) => format!("NOT sent: written to {} (set SMTP_HOST to send it)", dir.display()),
            Mailer::Log => "NOT sent: only logged (set SMTP_HOST to send it)".into(),
            Mailer::Memory(_) => "kept in memory (tests)".into(),
        }
    }

    /// What was sent (tests)
    pub fn sent(&self) -> Vec<Mail> {
        match self {
            Mailer::Memory(sent) => sent.lock().unwrap().clone(),
            _ => vec![],
        }
    }
}

// ---------- the mails ----------

pub fn verify(to: &str, name: &str, link: &str) -> Mail {
    Mail {
        to: to.into(),
        subject: "Confirm your email for Flow".into(),
        text: format!("Hi {name},\n\nConfirm your email address to finish setting up your Flow account:\n\n{link}\n\nThe link works for 2 days. Didn't sign up? Then you can ignore this mail."),
    }
}

pub fn reset(to: &str, name: &str, link: &str) -> Mail {
    Mail {
        to: to.into(),
        subject: "Reset your Flow password".into(),
        text: format!("Hi {name},\n\nSomeone asked to reset the password of your Flow account. Choose a new one here:\n\n{link}\n\nThe link works for 1 hour. Didn't ask for this? Then you can ignore this mail; your password stays the same."),
    }
}

pub fn invite(to: &str, from: &str, what: &str, role: &str, link: &str) -> Mail {
    Mail {
        to: to.into(),
        subject: format!("{from} invited you to {what} in Flow"),
        text: format!(
            "{from} invited you to {what} in Flow.\n\nIf you join, you can {role}.\n\nDo you want to join? Open the invitation to accept or decline it:\n\n{link}\n\nThe invitation works for 14 days. Nothing changes until you accept."
        ),
    }
}

/// To the one who invited: the answer.
pub fn answered(to: &str, name: &str, email: &str, what: &str, accepted: bool) -> Mail {
    let verb = if accepted { "accepted" } else { "declined" };
    Mail {
        to: to.into(),
        subject: format!("{name} {verb} your invitation to {what}"),
        text: format!("{name} ({email}) {verb} your invitation to {what} in Flow."),
    }
}

/// What someone with this role can do, for the mails.
pub fn role_words(role: flow_core::models::Role) -> &'static str {
    use flow_core::models::Role;
    match role {
        Role::Owner => "view, comment and edit",
        Role::CoOwner => "view, comment and edit, and invite and remove people",
        Role::Editor => "view, comment and edit",
        Role::Commenter => "view and comment",
        Role::Viewer => "view",
        Role::None => "see the boards shared with you",
    }
}

/// Someone @mentioned them in a comment.
pub fn mentioned(to: &str, name: &str, by: &str, board: &str, excerpt: &str, link: &str) -> Mail {
    Mail {
        to: to.into(),
        subject: format!("{by} mentioned you on {board}"),
        text: format!("Hi {name},\n\n{by} mentioned you in a comment on {board}:\n\n  {excerpt}\n\nAnswer it here:\n\n{link}\n"),
    }
}
