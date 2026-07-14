/**
 * Shadow Brain — Phase 4: AI Business Partner
 * Google Sheets Connector
 *
 * Provides read/write integration with Google Sheets for:
 * - Pulling business data (KPIs, pipelines, forecasts)
 * - Writing reports, experiment results, and memos
 * - Syncing CRM or pipeline data to spreadsheets
 *
 * Uses the Google Sheets API v4 via service-account OAuth.
 */

import { z } from 'zod';
import { google, sheets_v4 } from 'googleapis';
import { logger } from '@/lib/logger';

// ── Zod Schemas ────────────────────────────────────────────────────────────

export const SheetRangeSchema = z.object({
  spreadsheetId: z.string().min(1),
  range: z.string().min(1), // e.g. "Sheet1!A1:D10"
  majorDimension: z.enum(['ROWS', 'COLUMNS']).default('ROWS'),
});
export type SheetRange = z.infer<typeof SheetRangeSchema>;

export const SheetWriteRequestSchema = z.object({
  spreadsheetId: z.string().min(1),
  range: z.string().min(1),
  values: z.array(z.array(z.string())),
  valueInputOption: z.enum(['RAW', 'USER_ENTERED']).default('USER_ENTERED'),
});
export type SheetWriteRequest = z.infer<typeof SheetWriteRequestSchema>;

export const SheetAppendRequestSchema = z.object({
  spreadsheetId: z.string().min(1),
  range: z.string().min(1), // e.g. "Sheet1!A:A" or "Sheet1"
  values: z.array(z.array(z.string())),
  valueInputOption: z.enum(['RAW', 'USER_ENTERED']).default('USER_ENTERED'),
  insertDataOption: z.enum(['OVERWRITE', 'INSERT_ROWS']).default('INSERT_ROWS'),
});
export type SheetAppendRequest = z.infer<typeof SheetAppendRequestSchema>;

export const SheetBatchUpdateSchema = z.object({
  spreadsheetId: z.string().min(1),
  requests: z.array(z.record(z.unknown())), // Google Sheets API request objects
});
export type SheetBatchUpdate = z.infer<typeof SheetBatchUpdateSchema>;

export const SpreadsheetMetadataSchema = z.object({
  spreadsheetId: z.string(),
  title: z.string(),
  locale: z.string(),
  timeZone: z.string(),
  sheetCount: z.number().int(),
  sheetTitles: z.array(z.string()),
});
export type SpreadsheetMetadata = z.infer<typeof SpreadsheetMetadataSchema>;

// ── Auth & Client ──────────────────────────────────────────────────────────

let _sheetsClient: sheets_v4.Sheets | null = null;

function getSheetsClient(): sheets_v4.Sheets {
  if (_sheetsClient) return _sheetsClient;

  const credentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!credentials) {
    throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_JSON env var. Set it to the JSON key of a Google Cloud service account with Sheets/Drive scopes.');
  }

  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(credentials),
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.readonly',
    ],
  });

  _sheetsClient = google.sheets({ version: 'v4', auth });
  return _sheetsClient;
}

/** Reset the cached client (useful for testing or credential rotation). */
export function resetSheetsClient(): void {
  _sheetsClient = null;
}

// ── Read Operations ────────────────────────────────────────────────────────

/**
 * Read values from a Google Sheet range.
 * Returns a 2D array of strings (empty cells as empty strings).
 */
export async function readRange(req: SheetRange): Promise<string[][]> {
  const validated = SheetRangeSchema.parse(req);
  const sheets = getSheetsClient();

  logger.info('[sheets] readRange', { spreadsheetId: validated.spreadsheetId, range: validated.range });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: validated.spreadsheetId,
    range: validated.range,
    majorDimension: validated.majorDimension,
  });

  return (res.data.values ?? []) as string[][];
}

/**
 * Read multiple ranges in a single API call (batch get).
 */
export async function readRanges(spreadsheetId: string, ranges: string[]): Promise<Map<string, string[][]>> {
  const sheets = getSheetsClient();

  logger.info('[sheets] readRanges', { spreadsheetId, count: ranges.length });

  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges,
    majorDimension: 'ROWS',
  });

  const result = new Map<string, string[][]>();
  for (const vr of res.data.valueRanges ?? []) {
    if (vr.range) {
      result.set(vr.range, (vr.values ?? []) as string[][]);
    }
  }
  return result;
}

/**
 * Get metadata for a spreadsheet (title, sheets, locale, etc.).
 */
export async function getSpreadsheetMetadata(spreadsheetId: string): Promise<SpreadsheetMetadata> {
  const sheets = getSheetsClient();

  const res = await sheets.spreadsheets.get({
    spreadsheetId,
    includeGridData: false,
  });

  const data = res.data;
  return SpreadsheetMetadataSchema.parse({
    spreadsheetId: data.spreadsheetId,
    title: data.properties?.title ?? 'Untitled',
    locale: data.properties?.locale ?? 'en_US',
    timeZone: data.properties?.timeZone ?? 'America/New_York',
    sheetCount: data.sheets?.length ?? 0,
    sheetTitles: data.sheets?.map((s) => s.properties?.title ?? '').filter(Boolean) ?? [],
  });
}

// ── Write Operations ─────────────────────────────────────────────────────

/**
 * Write values to a specific range, overwriting existing data.
 */
export async function writeRange(req: SheetWriteRequest): Promise<{ updatedRows: number; updatedColumns: number }> {
  const validated = SheetWriteRequestSchema.parse(req);
  const sheets = getSheetsClient();

  logger.info('[sheets] writeRange', { spreadsheetId: validated.spreadsheetId, range: validated.range, rows: validated.values.length });

  const res = await sheets.spreadsheets.values.update({
    spreadsheetId: validated.spreadsheetId,
    range: validated.range,
    valueInputOption: validated.valueInputOption,
    requestBody: { values: validated.values },
  });

  return {
    updatedRows: res.data.updatedRows ?? 0,
    updatedColumns: res.data.updatedColumns ?? 0,
  };
}

/**
 * Append rows to the end of a range (typically a sheet or column).
 */
export async function appendRows(req: SheetAppendRequest): Promise<{ tableRange?: string; updates?: number }> {
  const validated = SheetAppendRequestSchema.parse(req);
  const sheets = getSheetsClient();

  logger.info('[sheets] appendRows', { spreadsheetId: validated.spreadsheetId, range: validated.range, rows: validated.values.length });

  const res = await sheets.spreadsheets.values.append({
    spreadsheetId: validated.spreadsheetId,
    range: validated.range,
    valueInputOption: validated.valueInputOption,
    insertDataOption: validated.insertDataOption,
    requestBody: { values: validated.values },
  });

  return {
    tableRange: res.data.tableRange ?? undefined,
    updates: res.data.updates?.updatedRows ?? 0,
  };
}

/**
 * Clear a range in a spreadsheet.
 */
export async function clearRange(spreadsheetId: string, range: string): Promise<void> {
  const sheets = getSheetsClient();

  logger.info('[sheets] clearRange', { spreadsheetId, range });

  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range,
  });
}

// ── Batch & Formatting ─────────────────────────────────────────────────────

/**
 * Execute a batch update (formatting, adding sheets, merging cells, etc.).
 */
export async function batchUpdate(req: SheetBatchUpdate): Promise<void> {
  const validated = SheetBatchUpdateSchema.parse(req);
  const sheets = getSheetsClient();

  logger.info('[sheets] batchUpdate', { spreadsheetId: validated.spreadsheetId, requestCount: validated.requests.length });

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: validated.spreadsheetId,
    requestBody: { requests: validated.requests as any[] },
  });
}

/**
 * Format a range with headers: bold, background color, freeze first row.
 */
export async function formatHeaderRow(spreadsheetId: string, sheetId: number, range: { startRow: number; endRow: number; startCol: number; endCol: number }): Promise<void> {
  const sheets = getSheetsClient();

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: range.startRow,
              endRowIndex: range.endRow,
              startColumnIndex: range.startCol,
              endColumnIndex: range.endCol,
            },
            cell: {
              userEnteredFormat: {
                textFormat: { bold: true },
                backgroundColor: { red: 0.95, green: 0.95, blue: 0.95 },
              },
            },
            fields: 'userEnteredFormat(textFormat,backgroundColor)',
          },
        },
        {
          updateSheetProperties: {
            properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
            fields: 'gridProperties.frozenRowCount',
          },
        },
      ],
    },
  });
}

// ── High-Level Helpers ───────────────────────────────────────────────────

/**
 * Export a structured JSON object (e.g., experiment results) as rows to a sheet.
 * Creates a header row automatically if the sheet is empty.
 */
export async function exportJsonToSheet<T extends Record<string, unknown>>(
  spreadsheetId: string,
  sheetName: string,
  rows: T[],
  options?: { includeHeaders?: boolean }
): Promise<void> {
  if (rows.length === 0) {
    logger.info('[sheets] exportJsonToSheet: no rows, skipping');
    return;
  }

  const includeHeaders = options?.includeHeaders ?? true;
  const keys = Object.keys(rows[0]);
  const values = rows.map((r) => keys.map((k) => String(r[k] ?? '')));

  if (includeHeaders) {
    await appendRows({
      spreadsheetId,
      range: sheetName,
      values: [keys, ...values],
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'OVERWRITE',
    });
  } else {
    await appendRows({
      spreadsheetId,
      range: sheetName,
      values,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
    });
  }

  logger.info('[sheets] exportJsonToSheet complete', { spreadsheetId, sheetName, rows: rows.length });
}

/**
 * Import a sheet range into a typed array of objects using the first row as headers.
 */
export async function importSheetToObjects<T extends Record<string, string>>(
  spreadsheetId: string,
  range: string
): Promise<T[]> {
  const rows = await readRange({ spreadsheetId, range });
  if (rows.length < 2) return [];

  const headers = rows[0];
  const data = rows.slice(1);

  return data.map((row) => {
    const obj: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      obj[headers[i]] = row[i] ?? '';
    }
    return obj as T;
  });
}
