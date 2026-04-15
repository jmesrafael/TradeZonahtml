/**
 * R2 Upload Client
 *
 * Utility for generating signed R2 upload URLs via Supabase Edge Function
 * and uploading files directly to Cloudflare R2.
 */

import { SupabaseClient } from "@supabase/supabase-js";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Response from generate-r2-upload-url Edge Function
 */
export interface R2UploadUrlResponse {
  upload_url: string; // Signed PUT URL (300 second expiry)
  public_url: string; // Public URL for storing in DB
  key: string; // S3 object key
}

/**
 * Error response from Edge Function
 */
export interface R2UploadError {
  error: string;
  code?: string;
}

/**
 * File upload options
 */
export interface R2UploadOptions {
  supabase: SupabaseClient;
  file: File;
  tradeId: string;
  onProgress?: (progress: number) => void; // 0-100
}

/**
 * Upload response
 */
export interface R2UploadResult {
  success: boolean;
  publicUrl?: string;
  key?: string;
  error?: string;
  code?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_FILE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate file before upload
 * Throws error if invalid
 */
export function validateFile(file: File): void {
  // Check file type
  if (!ALLOWED_FILE_TYPES.includes(file.type)) {
    throw new Error(
      `Invalid file type: ${file.type}. Allowed: ${ALLOWED_FILE_TYPES.join(", ")}`
    );
  }

  // Check file size
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(
      `File too large: ${(file.size / 1024 / 1024).toFixed(2)}MB. Max: 10MB`
    );
  }

  // Check file name
  if (!file.name || file.name.length === 0) {
    throw new Error("File must have a name");
  }
}

/**
 * Validate trade ID format (UUID)
 */
export function validateTradeId(tradeId: string): void {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (!uuidRegex.test(tradeId)) {
    throw new Error("Invalid trade ID format: must be a valid UUID");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EDGE FUNCTION API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get signed upload URL from Supabase Edge Function
 *
 * Makes POST request to generate-r2-upload-url function
 * Requires authenticated user with valid JWT
 *
 * @throws Error if function call fails
 * @returns R2UploadUrlResponse with upload_url, public_url, and key
 */
export async function getR2UploadUrl(
  supabase: SupabaseClient,
  fileName: string,
  fileType: string,
  tradeId: string
): Promise<R2UploadUrlResponse> {
  // Get current session
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();

  if (sessionError) {
    throw new Error(`Session error: ${sessionError.message}`);
  }

  if (!session?.access_token) {
    throw new Error("Not authenticated: no active session");
  }

  // Get function URL
  const supabaseUrl = process.env.REACT_APP_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (!supabaseUrl) {
    throw new Error("Supabase URL not configured");
  }

  // Call Edge Function
  const response = await fetch(
    `${supabaseUrl}/functions/v1/generate-r2-upload-url`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        file_name: fileName,
        file_type: fileType,
        trade_id: tradeId,
      }),
    }
  );

  // Handle response
  const data = await response.json();

  if (!response.ok) {
    const error: R2UploadError = data;
    throw new Error(
      `Failed to generate upload URL: ${error.error} (${error.code || "unknown"})`
    );
  }

  return data as R2UploadUrlResponse;
}

// ─────────────────────────────────────────────────────────────────────────────
// DIRECT R2 UPLOAD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Upload file directly to R2 using signed URL
 *
 * Makes PUT request to R2 endpoint with file content
 * Uses signed URL provided by Edge Function
 *
 * @throws Error if upload fails
 * @returns true if successful
 */
export async function uploadFileToR2(
  uploadUrl: string,
  file: File,
  onProgress?: (progress: number) => void
): Promise<boolean> {
  // For fetch API, we can't get upload progress directly
  // Progress estimation based on time or use XMLHttpRequest if needed

  try {
    const response = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": file.type,
      },
      body: file,
    });

    if (!response.ok) {
      throw new Error(
        `Upload failed: ${response.status} ${response.statusText}`
      );
    }

    if (onProgress) {
      onProgress(100);
    }

    return true;
  } catch (error) {
    throw new Error(
      `Upload to R2 failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Upload file with progress tracking using XMLHttpRequest
 *
 * Provides more accurate progress events than fetch API
 * Use this if you need real-time upload progress
 *
 * @throws Error if upload fails
 * @returns true if successful
 */
export async function uploadFileToR2WithProgress(
  uploadUrl: string,
  file: File,
  onProgress: (progress: number) => void
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    // Track upload progress
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        const percentComplete = (event.loaded / event.total) * 100;
        onProgress(percentComplete);
      }
    });

    // Handle completion
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve(true);
      } else {
        reject(
          new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`)
        );
      }
    });

    // Handle errors
    xhr.addEventListener("error", () => {
      reject(new Error("Upload failed: network error"));
    });

    xhr.addEventListener("abort", () => {
      reject(new Error("Upload cancelled"));
    });

    // Open request and set headers
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", file.type);

    // Send file
    xhr.send(file);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// COMBINED FLOW
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Complete flow: validate → get signed URL → upload → return public URL
 *
 * Main entry point for uploading a file to R2
 * Handles all steps: validation, signed URL generation, direct upload
 *
 * @returns R2UploadResult with success status and public URL or error
 */
export async function uploadToR2(
  options: R2UploadOptions
): Promise<R2UploadResult> {
  try {
    const { supabase, file, tradeId, onProgress } = options;

    // Step 1: Validate inputs
    validateFile(file);
    validateTradeId(tradeId);

    if (onProgress) onProgress(5);

    // Step 2: Get signed upload URL from Edge Function
    const uploadUrlResponse = await getR2UploadUrl(
      supabase,
      file.name,
      file.type,
      tradeId
    );

    if (onProgress) onProgress(20);

    // Step 3: Upload file directly to R2
    const progressCallback = onProgress
      ? (progress: number) => onProgress(20 + progress * 0.8) // 20% → 100%
      : undefined;

    await uploadFileToR2WithProgress(
      uploadUrlResponse.upload_url,
      file,
      progressCallback || (() => {})
    );

    // Step 4: Return success with public URL
    return {
      success: true,
      publicUrl: uploadUrlResponse.public_url,
      key: uploadUrlResponse.key,
    };
  } catch (error) {
    console.error("Upload to R2 failed:", error);

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      code: "UPLOAD_FAILED",
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert file size in bytes to human-readable format
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}

/**
 * Get file extension from file name
 */
export function getFileExtension(fileName: string): string {
  const parts = fileName.split(".");
  return parts[parts.length - 1].toLowerCase();
}

/**
 * Check if file type is image
 */
export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}
