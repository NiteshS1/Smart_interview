import { action } from "./_generated/server";
import { v } from "convex/values";

declare const process: { env: Record<string, string | undefined> };

type SendEmailPayload = {
  subject: string;
  html: string;
  to: string[];
};

async function sendViaResend(payload: SendEmailPayload) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;

  if (!apiKey) throw new Error("Missing RESEND_API_KEY");
  if (!from) throw new Error("Missing MAIL_FROM");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Resend error: ${res.status} ${text}`);
  }
}

export const sendInterviewEmails = action({
  args: {
    title: v.string(),
    startTime: v.number(),
    candidate: v.object({ name: v.string(), email: v.string() }),
    interviewers: v.array(v.object({ name: v.string(), email: v.string() })),
    organizerName: v.string(),
  },
  handler: async (_ctx, args) => {
    const when = new Date(args.startTime).toLocaleString("en-US", {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

    const interviewerNames = args.interviewers.map((i) => i.name).join(", ");

    const subject = `Interview Scheduled: ${args.title} on ${when}`;

    const candidateHtml = `
      <div>
        <p>Hi ${args.candidate.name},</p>
        <p>Your interview has been scheduled.</p>
        <ul>
          <li><strong>Title:</strong> ${args.title}</li>
          <li><strong>Date & Time:</strong> ${when}</li>
          <li><strong>Interviewer(s):</strong> ${interviewerNames}</li>
          <li><strong>Scheduled by:</strong> ${args.organizerName}</li>
        </ul>
      </div>
    `;

    const interviewerHtml = `
      <div>
        <p>Hello,</p>
        <p>You have been assigned to conduct an interview.</p>
        <ul>
          <li><strong>Title:</strong> ${args.title}</li>
          <li><strong>Date & Time:</strong> ${when}</li>
          <li><strong>Candidate:</strong> ${args.candidate.name}</li>
          <li><strong>Scheduled by:</strong> ${args.organizerName}</li>
        </ul>
      </div>
    `;

    await sendViaResend({ subject, html: candidateHtml, to: [args.candidate.email] });

    const interviewerEmails = args.interviewers.map((i) => i.email);
    if (interviewerEmails.length > 0) {
      await sendViaResend({ subject, html: interviewerHtml, to: interviewerEmails });
    }

    return { ok: true };
  },
});


