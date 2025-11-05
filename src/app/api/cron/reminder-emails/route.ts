import nodemailer, { Transporter } from "nodemailer";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../convex/_generated/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// In-memory cache to track sent reminders (resets on server restart)
// In production, use a proper cache like Redis or add a field to the database
const sentReminders = new Set<string>();

function getReminderCacheKey(interviewId: string, startTime: number): string {
  // Use interview ID + a time window (hour) to avoid duplicates
  const hour = Math.floor(startTime / (60 * 60 * 1000));
  return `${interviewId}-${hour}`;
}

async function sendReminderEmail(
  transporter: Transporter,
  from: string,
  title: string,
  startTime: number,
  candidate: { name: string; email: string },
  interviewers: { name: string; email: string }[],
) {
  const when = new Date(startTime).toLocaleString("en-US", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  const interviewerNames = interviewers.map((i) => i.name).join(", ");

  const subject = `Reminder: Interview "${title}" starts in 1 hour`;

  const candidateHtml = `
    <div>
      <p>Hi ${candidate.name},</p>
      <p><strong>This is a reminder:</strong> Your interview is scheduled to start in 1 hour.</p>
      <ul>
        <li><strong>Title:</strong> ${title}</li>
        <li><strong>Date & Time:</strong> ${when}</li>
        <li><strong>Interviewer(s):</strong> ${interviewerNames}</li>
      </ul>
      <p>Please make sure you're ready to join on time.</p>
    </div>
  `;

  const interviewerHtml = `
    <div>
      <p>Hello,</p>
      <p><strong>This is a reminder:</strong> You have an interview scheduled to start in 1 hour.</p>
      <ul>
        <li><strong>Title:</strong> ${title}</li>
        <li><strong>Date & Time:</strong> ${when}</li>
        <li><strong>Candidate:</strong> ${candidate.name}</li>
      </ul>
      <p>Please make sure you're ready to conduct the interview.</p>
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
  const interviewerEmails = interviewers.map((i) => i.email);
  if (interviewerEmails.length > 0) {
    await transporter.sendMail({
      from,
      to: interviewerEmails,
      subject,
      html: interviewerHtml,
    });
  }
}

export async function GET(request: Request) {
  try {
    // Verify cron secret (optional - for security)
    const authHeader = request.headers.get("authorization");
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return new Response("Unauthorized", { status: 401 });
    }

    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS || !process.env.MAIL_FROM) {
      return new Response(
        JSON.stringify({ error: "missing_env", details: ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "MAIL_FROM"] }),
        { status: 400 }
      );
    }

    if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
      return new Response(JSON.stringify({ error: "missing_convex_url" }), { status: 400 });
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
    await transporter.verify();

    // Query Convex for upcoming interviews
    const convexClient = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL);
    const upcomingInterviews = await convexClient.query(api.interviews.getUpcomingInterviewsForReminder);

    if (!upcomingInterviews || upcomingInterviews.length === 0) {
      return new Response(JSON.stringify({ message: "No upcoming interviews to remind", count: 0 }), { status: 200 });
    }

    // Get all users to map IDs to emails (using cron-friendly query)
    const allUsers = await convexClient.query(api.users.getAllUsersForCron);

    let sentCount = 0;
    const errors: string[] = [];

    for (const interview of upcomingInterviews) {
      const cacheKey = getReminderCacheKey(interview._id, interview.startTime);

      // Skip if already sent reminder for this interview in this time window
      if (sentReminders.has(cacheKey)) {
        continue;
      }

      try {
        // Find candidate
        const candidate = allUsers?.find((u) => u.clerkId === interview.candidateId);
        if (!candidate) {
          errors.push(`Candidate not found for interview ${interview._id}`);
          continue;
        }

        // Find interviewers
        const interviewerUsers = interview.interviewerIds
          .map((clerkId) => allUsers?.find((u) => u.clerkId === clerkId))
          .filter((u): u is NonNullable<typeof u> => u !== undefined);

        if (interviewerUsers.length === 0) {
          errors.push(`No interviewers found for interview ${interview._id}`);
          continue;
        }

        // Send reminder emails
        await sendReminderEmail(
          transporter,
          from,
          interview.title,
          interview.startTime,
          { name: candidate.name, email: candidate.email },
          interviewerUsers.map((u) => ({ name: u.name, email: u.email }))
        );

        // Mark as sent
        sentReminders.add(cacheKey);
        sentCount++;

        // Clean up old cache entries (keep only last 24 hours worth)
        if (sentReminders.size > 1000) {
          const now = Date.now();
          const oneDayAgo = now - 24 * 60 * 60 * 1000;
          for (const key of Array.from(sentReminders)) {
            const parts = key.split("-");
            if (parts.length === 2) {
              const hour = parseInt(parts[1], 10);
              const timestamp = hour * 60 * 60 * 1000;
              if (timestamp < oneDayAgo) {
                sentReminders.delete(key);
              }
            }
          }
        }
      } catch (error: any) {
        errors.push(`Failed to send reminder for interview ${interview._id}: ${error?.message || error}`);
        console.error(`Error sending reminder for interview ${interview._id}:`, error);
      }
    }

    return new Response(
      JSON.stringify({
        message: "Reminder emails processed",
        sent: sentCount,
        total: upcomingInterviews.length,
        errors: errors.length > 0 ? errors : undefined,
      }),
      { status: 200 }
    );
  } catch (error: any) {
    console.error("/api/cron/reminder-emails error:", error);
    return new Response(
      JSON.stringify({ error: "failed_to_process", message: String(error?.message || error) }),
      { status: 500 }
    );
  }
}

