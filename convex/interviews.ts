import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const getAllInterviews = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const interviews = await ctx.db.query("interviews").collect();

    return interviews;
  },
});

export const getMyInterviews = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const interviews = await ctx.db
      .query("interviews")
      .withIndex("by_candidate_id", (q) => q.eq("candidateId", identity.subject))
      .collect();

    return interviews!;
  },
});

export const getInterviewByStreamCallId = query({
  args: { streamCallId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("interviews")
      .withIndex("by_stream_call_id", (q) => q.eq("streamCallId", args.streamCallId))
      .first();
  },
});

export const createInterview = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    startTime: v.number(),
    status: v.string(),
    streamCallId: v.string(),
    candidateId: v.string(),
    interviewerIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const insertedId = await ctx.db.insert("interviews", {
      ...args,
    });

    return insertedId;
  },
});

export const updateInterviewStatus = mutation({
  args: {
    id: v.id("interviews"),
    status: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.patch(args.id, {
      status: args.status,
      ...(args.status === "completed" ? { endTime: Date.now() } : {}),
    });
  },
});

export const getUpcomingInterviewsForReminder = query({
  handler: async (ctx) => {
    // No auth check - this is for cron/internal use
    const now = Date.now();
    const oneHourFromNow = now + 60 * 60 * 1000; // 1 hour in milliseconds
    const fiftyFiveMinutesFromNow = now + 55 * 60 * 1000; // 55 minutes

    const allInterviews = await ctx.db.query("interviews").collect();

    const upcomingInterviews = allInterviews.filter((interview) => {
      return (
        interview.status === "upcoming" &&
        interview.startTime >= fiftyFiveMinutesFromNow &&
        interview.startTime <= oneHourFromNow
      );
    });

    return upcomingInterviews;
  },
});
