import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { escapeHtml } from "@/lib/server/escape-html";

export const runtime = "nodejs";

const RECIPIENT_EMAIL = "kumaraman19137@gmail.com";

interface ContactRequestBody {
  name: string;
  email: string;
  subject?: string;
  message: string;
}

export async function POST(req: NextRequest) {
  try {
    const body: ContactRequestBody = await req.json();
    const { name, email, subject, message } = body;

    // 1. Strict Input Validation
    if (!name || typeof name !== "string" || name.trim().length < 2) {
      return NextResponse.json(
        { success: false, error: "Please enter your name (at least 2 characters)." },
        { status: 400 }
      );
    }

    if (!email || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return NextResponse.json(
        { success: false, error: "Please provide a valid email address." },
        { status: 400 }
      );
    }

    if (!message || typeof message !== "string" || message.trim().length < 10) {
      return NextResponse.json(
        { success: false, error: "Please write a message of at least 10 characters." },
        { status: 400 }
      );
    }

    if (name.length > 120 || email.length > 254 || message.length > 5000 || (subject && String(subject).length > 200)) {
      return NextResponse.json(
        { success: false, error: "Your message is too long. Please shorten it and try again." },
        { status: 400 }
      );
    }

    // Header-safe plain values (no line breaks) and HTML-escaped copies for the email body
    const cleanName = name.trim().replace(/[\r\n]+/g, " ");
    const cleanEmail = email.trim();
    const cleanSubject = (typeof subject === "string" && subject.trim() ? subject : "Book Recommendation / Reader Feedback")
      .trim()
      .replace(/[\r\n]+/g, " ");
    const cleanMessage = message.trim();
    const htmlName = escapeHtml(cleanName);
    const htmlEmail = escapeHtml(cleanEmail);
    const htmlSubject = escapeHtml(cleanSubject);
    const htmlMessage = escapeHtml(cleanMessage);
    const timestamp = new Date().toLocaleString("en-US", { timeZoneName: "short" });

    // Safe debugging log (Never log secret values)
    const apiKeyConfigured = Boolean(process.env.RESEND_API_KEY);
    console.log(`[CONTACT API] Incoming submission from "${cleanName}" <${cleanEmail}>`);
    console.log(`[CONTACT API] RESEND_API_KEY present: ${apiKeyConfigured}`);
    console.log(`[CONTACT API] Target recipient: ${RECIPIENT_EMAIL}`);

    const resendApiKey = process.env.RESEND_API_KEY;
    const resendFrom = process.env.RESEND_FROM_EMAIL || "Reader's HUB <onboarding@resend.dev>";

    if (!resendApiKey) {
      console.warn("[CONTACT API] RESEND_API_KEY is not defined in environment variables.");
      return NextResponse.json(
        {
          success: false,
          error: "RESEND_API_KEY is not configured in your environment variables. Please add RESEND_API_KEY to your .env or Vercel Environment Variables.",
          recipient: RECIPIENT_EMAIL,
        },
        { status: 503 }
      );
    }

    // Initialize Resend Client
    const resend = new Resend(resendApiKey);

    const { data, error } = await resend.emails.send({
      from: resendFrom,
      to: [RECIPIENT_EMAIL],
      replyTo: cleanEmail,
      subject: `[Reader's HUB] ${cleanSubject} — from ${cleanName}`,
      text: `Name: ${cleanName}\nEmail: ${cleanEmail}\nSubject: ${cleanSubject}\nDate: ${timestamp}\n\nMessage:\n${cleanMessage}`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff;">
          <div style="border-bottom: 2px solid #f59e0b; padding-bottom: 16px; margin-bottom: 20px;">
            <h2 style="color: #0f172a; margin: 0; font-size: 20px;">📬 New Message via Reader's HUB</h2>
            <p style="color: #64748b; font-size: 12px; margin: 4px 0 0 0;">Received on ${timestamp}</p>
          </div>
          
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 14px;">
            <tr>
              <td style="padding: 6px 0; color: #64748b; width: 80px; font-weight: 600;">Sender:</td>
              <td style="padding: 6px 0; color: #0f172a; font-weight: bold;">${htmlName}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #64748b; font-weight: 600;">Email:</td>
              <td style="padding: 6px 0; color: #2563eb;"><a href="mailto:${htmlEmail}" style="color: #2563eb; text-decoration: none;">${htmlEmail}</a></td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #64748b; font-weight: 600;">Topic:</td>
              <td style="padding: 6px 0; color: #0f172a;">${htmlSubject}</td>
            </tr>
          </table>

          <div style="padding: 16px; background-color: #f8fafc; border-left: 4px solid #f59e0b; border-radius: 8px; margin-bottom: 24px;">
            <h4 style="margin: 0 0 8px 0; color: #334155; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">Message Content:</h4>
            <p style="margin: 0; color: #1e293b; font-size: 14px; line-height: 1.6; white-space: pre-wrap;">${htmlMessage}</p>
          </div>

          <div style="border-top: 1px solid #e2e8f0; padding-top: 16px; text-align: center;">
            <p style="font-size: 11px; color: #94a3b8; margin: 0;">
              Sent via Reader's HUB Contact API to <strong>${RECIPIENT_EMAIL}</strong> • Reply directly to this email to respond to ${htmlName}.
            </p>
          </div>
        </div>
      `,
    });

    if (error) {
      console.error("[CONTACT API: Resend Error]", error);
      return NextResponse.json(
        {
          success: false,
          error: `Resend delivery failed: ${error.message || "Unknown error"}.`,
        },
        { status: 502 }
      );
    }

    console.log(`[CONTACT API] Email sent successfully via Resend. Message ID: ${data?.id}`);

    return NextResponse.json({
      success: true,
      message: `Your message has been sent to Aman Dubey (${RECIPIENT_EMAIL}).`,
      messageId: data?.id,
      timestamp,
    });
  } catch (error: any) {
    console.error("[CONTACT API: Fatal Error]", error);
    return NextResponse.json(
      {
        success: false,
        error: "An unexpected server error occurred while sending your note. Please try again or email kumaraman19137@gmail.com directly.",
      },
      { status: 500 }
    );
  }
}
