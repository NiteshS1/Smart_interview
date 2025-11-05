import nodemailer from "nodemailer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { title, startTime, candidate, interviewers, organizerName } = await request.json();

    const when = new Date(startTime).toLocaleString("en-US", {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS || !process.env.MAIL_FROM) {
      return new Response(
        JSON.stringify({ error: "missing_env", details: ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "MAIL_FROM"] }),
        { status: 400 }
      );
    }

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT || 587) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    const from = process.env.MAIL_FROM as string;

    // Ensure SMTP creds are valid before sending
    await transporter.verify();

    const interviewerNames = (interviewers || []).map((i: any) => i.name).join(", ");

    const subject = `Interview Scheduled: ${title} on ${when}`;

    const candidateHtml = `
      <div>
        <p>Hi ${candidate.name},</p>
        <p>Your interview has been scheduled.</p>
        <ul>
          <li><strong>Title:</strong> ${title}</li>
          <li><strong>Date & Time:</strong> ${when}</li>
          <li><strong>Interviewer(s):</strong> ${interviewerNames}</li>
          <li><strong>Scheduled by:</strong> ${organizerName}</li>
        </ul>
      </div>
    `;

    const interviewerHtml = `
      <div>
        <p>Hello,</p>
        <p>You have been assigned to conduct an interview.</p>
        <ul>
          <li><strong>Title:</strong> ${title}</li>
          <li><strong>Date & Time:</strong> ${when}</li>
          <li><strong>Candidate:</strong> ${candidate.name}</li>
          <li><strong>Scheduled by:</strong> ${organizerName}</li>
        </ul>
      </div>
    `;

    // Send to candidate
    await transporter.sendMail({
      from,
      to: candidate.email,
      subject,
      html: candidateHtml,
    });

    // Send to interviewers (batch)
    const interviewerEmails = (interviewers || []).map((i: any) => i.email);
    if (interviewerEmails.length > 0) {
      await transporter.sendMail({
        from,
        to: interviewerEmails,
        subject,
        html: interviewerHtml,
      });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (error: any) {
    console.error("/api/send-interview-emails error:", error);
    return new Response(
      JSON.stringify({ error: "failed_to_send", message: String(error?.message || error) }),
      { status: 500 }
    );
  }
}


