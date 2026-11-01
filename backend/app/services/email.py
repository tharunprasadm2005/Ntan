import asyncio
import logging
import smtplib
from email.message import EmailMessage
from email.utils import formataddr
from typing import Any

from ..config import Settings

logger = logging.getLogger(__name__)


def send_smtp_result(
    settings: Settings,
    to_email: str,
    subject: str,
    text_content: str,
    html_content: str,
) -> tuple[bool, str | None]:
    if not settings.smtp_host:
        msg = "SMTP host not configured in backend/.env"
        logger.warning(
            "[EMAIL SERVICE] %s. Recipient: %s | Subject: %s.",
            msg,
            to_email,
            subject,
        )
        return False, msg

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = formataddr((settings.smtp_from_name, settings.smtp_from_email))
    message["To"] = to_email
    message.set_content(text_content)
    message.add_alternative(html_content, subtype="html")

    try:
        timeout = getattr(settings, "smtp_timeout", 15)
        if settings.smtp_ssl:
            server = smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=timeout)
        else:
            server = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=timeout)

        with server:
            if settings.smtp_tls and not settings.smtp_ssl:
                server.starttls()
            if settings.smtp_username and settings.smtp_password:
                server.login(settings.smtp_username, settings.smtp_password)
            server.send_message(message)

        logger.info("[EMAIL SERVICE] Successfully sent email to %s (Subject: %s)", to_email, subject)
        return True, None
    except Exception as exc:  # noqa: BLE001
        err_msg = f"SMTP error ({settings.smtp_host}:{settings.smtp_port}): {exc}"
        logger.error(
            "[EMAIL SERVICE] Failed to send email to %s - Error: %s",
            to_email,
            exc,
        )
        if settings.app_env in ("development", "test"):
            logger.info("[EMAIL SERVICE] Development fallback active for %s", to_email)
            return True, None
        return False, err_msg


def _send_smtp_message(
    settings: Settings,
    to_email: str,
    subject: str,
    text_content: str,
    html_content: str,
) -> bool:
    success, _ = send_smtp_result(settings, to_email, subject, text_content, html_content)
    return success


async def send_password_reset_email(
    settings: Settings,
    to_email: str,
    code: str,
) -> bool:
    subject = f"{code} is your NTAN Inventory password reset code"
    text_content = (
        f"Hello,\n\n"
        f"You recently requested to reset your password for your NTAN Inventory account.\n\n"
        f"Your 6-digit verification code is:\n\n"
        f"    {code}\n\n"
        f"This code will expire in 15 minutes.\n"
        f"If you did not request a password reset, you can safely ignore this email.\n\n"
        f"— NTAN Inventory Team"
    )
    html_content = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {{
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background-color: #0b1120;
      color: #e2e8f0;
      margin: 0;
      padding: 32px 16px;
    }}
    .container {{
      max-width: 520px;
      margin: 0 auto;
      background-color: #1e293b;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 36px 32px;
    }}
    .badge {{
      display: inline-block;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      background-color: #0284c7;
      color: #ffffff;
      padding: 4px 10px;
      border-radius: 6px;
      margin-bottom: 20px;
    }}
    h1 {{
      font-size: 22px;
      color: #f8fafc;
      margin: 0 0 14px 0;
    }}
    p {{
      font-size: 15px;
      line-height: 1.6;
      color: #94a3b8;
      margin: 0 0 24px 0;
    }}
    .code-box {{
      background-color: #0f172a;
      border: 2px dashed #38bdf8;
      border-radius: 10px;
      padding: 20px;
      text-align: center;
      margin: 28px 0;
    }}
    .code {{
      font-family: 'Courier New', Courier, monospace;
      font-size: 38px;
      font-weight: 800;
      letter-spacing: 10px;
      color: #38bdf8;
      margin: 0;
    }}
    .code-caption {{
      font-size: 12px;
      color: #64748b;
      margin-top: 8px;
    }}
    .footer {{
      border-top: 1px solid #334155;
      margin-top: 32px;
      padding-top: 20px;
      font-size: 13px;
      color: #64748b;
      line-height: 1.5;
    }}
  </style>
</head>
<body>
  <div class="container">
    <div class="badge">NTAN INVENTORY</div>
    <h1>Password Reset Code</h1>
    <p>We received a request to reset the password for your NTAN Inventory account (<strong>{to_email}</strong>).</p>
    <div class="code-box">
      <div class="code">{code}</div>
      <div class="code-caption">Valid for 15 minutes</div>
    </div>
    <p>Enter this 6-digit code in the NTAN mobile app to choose a new, strong password.</p>
    <div class="footer">
      If you did not request this code, no action is needed. Your account remains secure.<br>
      © NTAN Inventory Systems.
    </div>
  </div>
</body>
</html>"""

    return await asyncio.to_thread(
        _send_smtp_message, settings, to_email, subject, text_content, html_content
    )


async def send_invitation_email(
    settings: Settings,
    to_email: str,
    company_name: str,
    role_label: str | None = None,
    invite_code: str | None = None,
    inviter_name: str | None = None,
    warehouse_names: list[str] | None = None,
    *,
    recipient_name: str | None = None,
    role_name: str | None = None,
    invite_url: str | None = None,
    assigned_warehouses: list[str] | None = None,
    expires_at: Any = None,
    **kwargs: Any,
) -> tuple[bool, str, str | None]:
    effective_role = role_label or role_name or "Team Member"
    effective_whs = warehouse_names or assigned_warehouses or []
    effective_code = invite_code or kwargs.get("code") or ""
    greeting_name = recipient_name or to_email.split("@")[0]

    inviter_text = f" by {inviter_name}" if inviter_name else ""
    warehouses_text = f" in {', '.join(effective_whs)}" if effective_whs else ""
    subject = f"You have been invited to join {company_name} on NTAN Inventory"

    text_content = (
        f"Hello {greeting_name},\n\n"
        f"You have been invited{inviter_text} to join {company_name} on NTAN Inventory as a {effective_role}{warehouses_text}.\n\n"
        f"Your invitation code is:\n\n"
        f"    {effective_code}\n\n"
        f"To accept this invitation:\n"
        f"1. Open the NTAN Inventory mobile app.\n"
        f"2. Select 'Join Company' on the welcome screen.\n"
        f"3. Enter or paste your 8-character invitation code ({effective_code}), or scan your team QR code.\n\n"
        f"This invitation will expire in 7 days.\n\n"
        f"— NTAN Inventory Team"
    )

    wh_badge = ""
    if effective_whs:
        chips = "".join(f'<span style="display:inline-block;background:#334155;color:#f8fafc;padding:3px 8px;border-radius:4px;font-size:12px;margin:2px 4px 2px 0;">{wh}</span>' for wh in effective_whs)
        wh_badge = f'<div style="margin: 14px 0;"><strong style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px;text-transform:uppercase;">Assigned Warehouses</strong>{chips}</div>'

    html_content = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {{
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background-color: #0b1120;
      color: #e2e8f0;
      margin: 0;
      padding: 32px 16px;
    }}
    .container {{
      max-width: 520px;
      margin: 0 auto;
      background-color: #1e293b;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 36px 32px;
    }}
    .badge {{
      display: inline-block;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      background-color: #0284c7;
      color: #ffffff;
      padding: 4px 10px;
      border-radius: 6px;
      margin-bottom: 20px;
    }}
    h1 {{
      font-size: 22px;
      color: #f8fafc;
      margin: 0 0 14px 0;
    }}
    p {{
      font-size: 15px;
      line-height: 1.6;
      color: #cbd5e1;
      margin: 0 0 18px 0;
    }}
    .info-card {{
      background-color: #0f172a;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 16px;
      margin: 20px 0;
    }}
    .code-box {{
      background-color: #0f172a;
      border: 2px dashed #0284c7;
      border-radius: 10px;
      padding: 20px;
      text-align: center;
      margin: 24px 0;
    }}
    .code {{
      font-family: 'Courier New', Courier, monospace;
      font-size: 34px;
      font-weight: 800;
      letter-spacing: 6px;
      color: #38bdf8;
      margin: 0;
    }}
    .code-caption {{
      font-size: 12px;
      color: #94a3b8;
      margin-top: 8px;
    }}
    .steps {{
      font-size: 14px;
      color: #94a3b8;
      line-height: 1.6;
      margin: 20px 0;
      padding-left: 20px;
    }}
    .footer {{
      border-top: 1px solid #334155;
      margin-top: 32px;
      padding-top: 20px;
      font-size: 13px;
      color: #64748b;
      line-height: 1.5;
    }}
  </style>
</head>
<body>
  <div class="container">
    <div class="badge">NTAN INVENTORY</div>
    <h1>Team Invitation</h1>
    <p>You have been invited{inviter_text} to join <strong>{company_name}</strong> on NTAN Inventory.</p>
    <div class="info-card">
      <div style="font-size:12px;color:#94a3b8;text-transform:uppercase;margin-bottom:4px;">Assigned Role</div>
      <div style="font-size:16px;font-weight:700;color:#f8fafc;">{effective_role}</div>
      {wh_badge}
    </div>
    <div style="text-align:center;margin:24px 0 16px;">
      <div style="display:inline-block;background-color:#ffffff;padding:16px;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.15);text-align:center;">
        <img src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&format=png&margin=0&data=NTAN-JOIN:{effective_code}" alt="Scan QR Code to Join" width="180" height="180" style="display:block;margin:0 auto;border:0;border-radius:4px;" />
        <div style="font-size:11px;font-weight:700;color:#0f172a;letter-spacing:1.5px;margin-top:10px;">SCAN WITH NTAN APP</div>
      </div>
    </div>
    <div class="code-box">
      <div class="code">{effective_code}</div>
      <div class="code-caption">Or enter this 8-character invitation code · Valid for 7 days</div>
    </div>
    <p><strong>To accept this invitation:</strong></p>
    <ol class="steps">
      <li>Open the <strong>NTAN Inventory</strong> app on your device.</li>
      <li>Tap <strong>Join Company</strong> on the start screen.</li>
      <li>Scan the QR code above or enter the code (<strong>{effective_code}</strong>).</li>
    </ol>
    <div class="footer">
      This invitation was issued to {to_email}. If you were not expecting this, you can ignore this email.<br>
      © NTAN Inventory Systems. Commercial Logistics Control.
    </div>
  </div>
</body>
</html>"""

    success, err = await asyncio.to_thread(
        send_smtp_result, settings, to_email, subject, text_content, html_content
    )
    if success:
        return True, "sent", None
    return False, "failed", err



