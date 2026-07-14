/**
 * src/lib/tools/calendar.ts
 * Google Calendar API tools for the LangGraph agent.
 * Supports listing events, creating events, and updating events.
 */

import { google, calendar_v3 } from 'googleapis';
import { z } from 'zod';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { logger } from '@/lib/logger';

// ---------------------------------------------------------------------------
// Calendar Client Factory
// ---------------------------------------------------------------------------

function createCalendarClient(accessToken: string): calendar_v3.Calendar {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.calendar({ version: 'v3', auth });
}

// ---------------------------------------------------------------------------
// Tool: List Calendar Events
// ---------------------------------------------------------------------------

const ListEventsSchema = z.object({
  accessToken: z.string().describe('OAuth2 access token for Google Calendar.'),
  calendarId: z.string().default('primary').describe('Calendar ID (default: primary).'),
  timeMin: z.string().optional().describe('ISO datetime for start of range (e.g., 2026-07-14T00:00:00Z).'),
  timeMax: z.string().optional().describe('ISO datetime for end of range.'),
  maxResults: z.number().int().min(1).max(100).default(10).describe('Maximum events to return.'),
  query: z.string().optional().describe('Free-text search query (e.g., "team standup").'),
});

export const listEventsTool = new DynamicStructuredTool({
  name: 'list_calendar_events',
  description:
    'List upcoming or past events from the user\'s Google Calendar within a time range. ' +
    'Returns event summaries, start/end times, locations, and descriptions.',
  schema: ListEventsSchema,
  func: async ({ accessToken, calendarId, timeMin, timeMax, maxResults, query }) => {
    try {
      const calendar = createCalendarClient(accessToken);
      const res = await calendar.events.list({
        calendarId,
        timeMin: timeMin ?? new Date().toISOString(),
        timeMax,
        maxResults,
        q: query,
        singleEvents: true,
        orderBy: 'startTime',
      });

      const items = res.data.items ?? [];
      const events = items.map((evt) => ({
        id: evt.id,
        summary: evt.summary ?? '(no title)',
        start: evt.start?.dateTime ?? evt.start?.date,
        end: evt.end?.dateTime ?? evt.end?.date,
        location: evt.location ?? '',
        description: (evt.description ?? '').slice(0, 500),
        attendees: (evt.attendees ?? []).map((a) => a.email).filter(Boolean),
        status: evt.status,
        htmlLink: evt.htmlLink,
      }));

      return JSON.stringify({ events, count: events.length });
    } catch (err) {
      logger.error('Calendar list failed', { error: (err as Error).message });
      return JSON.stringify({ error: (err as Error).message });
    }
  },
});

// ---------------------------------------------------------------------------
// Tool: Create Calendar Event
// ---------------------------------------------------------------------------

const CreateEventSchema = z.object({
  accessToken: z.string().describe('OAuth2 access token for Google Calendar.'),
  summary: z.string().describe('Event title.'),
  start: z.string().describe('ISO datetime for event start (e.g., 2026-07-14T09:00:00Z).'),
  end: z.string().describe('ISO datetime for event end.'),
  description: z.string().optional().describe('Event description / agenda.'),
  location: z.string().optional().describe('Physical or virtual location.'),
  attendees: z
    .array(z.string().email())
    .optional()
    .describe('List of attendee email addresses.'),
  calendarId: z.string().default('primary').describe('Target calendar ID.'),
});

export const createEventTool = new DynamicStructuredTool({
  name: 'create_calendar_event',
  description:
    'Create a new event on the user\'s Google Calendar. Returns the created event ID and link.',
  schema: CreateEventSchema,
  func: async ({ accessToken, summary, start, end, description, location, attendees, calendarId }) => {
    try {
      const calendar = createCalendarClient(accessToken);
      const res = await calendar.events.insert({
        calendarId,
        requestBody: {
          summary,
          description,
          location,
          start: { dateTime: start, timeZone: 'UTC' },
          end: { dateTime: end, timeZone: 'UTC' },
          attendees: attendees?.map((email) => ({ email })),
        },
      });

      logger.info('Calendar event created', { eventId: res.data.id, summary });
      return JSON.stringify({
        success: true,
        eventId: res.data.id,
        summary: res.data.summary,
        htmlLink: res.data.htmlLink,
      });
    } catch (err) {
      logger.error('Calendar create failed', { error: (err as Error).message, summary });
      return JSON.stringify({ error: (err as Error).message, summary });
    }
  },
});

// ---------------------------------------------------------------------------
// Tool: Update Calendar Event
// ---------------------------------------------------------------------------

const UpdateEventSchema = z.object({
  accessToken: z.string().describe('OAuth2 access token for Google Calendar.'),
  eventId: z.string().describe('ID of the event to update.'),
  summary: z.string().optional().describe('New event title.'),
  start: z.string().optional().describe('New ISO datetime for start.'),
  end: z.string().optional().describe('New ISO datetime for end.'),
  description: z.string().optional().describe('New description.'),
  location: z.string().optional().describe('New location.'),
  calendarId: z.string().default('primary').describe('Calendar ID.'),
});

export const updateEventTool = new DynamicStructuredTool({
  name: 'update_calendar_event',
  description:
    'Update an existing Google Calendar event by ID. Only provided fields are changed.',
  schema: UpdateEventSchema,
  func: async ({ accessToken, eventId, summary, start, end, description, location, calendarId }) => {
    try {
      const calendar = createCalendarClient(accessToken);

      const patchBody: calendar_v3.Schema$Event = {};
      if (summary !== undefined) patchBody.summary = summary;
      if (description !== undefined) patchBody.description = description;
      if (location !== undefined) patchBody.location = location;
      if (start) patchBody.start = { dateTime: start, timeZone: 'UTC' };
      if (end) patchBody.end = { dateTime: end, timeZone: 'UTC' };

      const res = await calendar.events.patch({
        calendarId,
        eventId,
        requestBody: patchBody,
      });

      logger.info('Calendar event updated', { eventId });
      return JSON.stringify({
        success: true,
        eventId: res.data.id,
        summary: res.data.summary,
        htmlLink: res.data.htmlLink,
      });
    } catch (err) {
      logger.error('Calendar update failed', { error: (err as Error).message, eventId });
      return JSON.stringify({ error: (err as Error).message, eventId });
    }
  },
});

// ---------------------------------------------------------------------------
// Tool Registry Export
// ---------------------------------------------------------------------------

export const calendarTools = [listEventsTool, createEventTool, updateEventTool];
