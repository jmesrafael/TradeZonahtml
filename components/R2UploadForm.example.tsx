/**
 * R2 Upload Form Component Example
 *
 * Example React component demonstrating how to use R2UploadClient
 * for uploading trading images directly to Cloudflare R2
 *
 * USAGE:
 * Replace this with your actual implementation, or use as reference
 */

import React, { useState, useRef } from "react";
import { useSupabaseClient } from "@supabase/auth-helpers-react";
import {
  uploadToR2,
  validateFile,
  validateTradeId,
  formatFileSize,
} from "@/lib/r2-upload-client";

interface R2UploadFormProps {
  tradeId: string;
  onSuccess?: (publicUrl: string, key: string) => void;
  onError?: (error: string) => void;
}

export function R2UploadForm({
  tradeId,
  onSuccess,
  onError,
}: R2UploadFormProps) {
  const supabase = useSupabaseClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ─────────────────────────────────────────────────────────────────────────
  // EVENT HANDLERS
  // ─────────────────────────────────────────────────────────────────────────

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];

    // Validate file
    try {
      validateFile(file);
      setSelectedFile(file);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setSelectedFile(null);
      onError?.(message);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      setError("No file selected");
      return;
    }

    try {
      // Validate trade ID
      validateTradeId(tradeId);

      // Start upload
      setIsLoading(true);
      setError(null);
      setUploadProgress(0);

      const result = await uploadToR2({
        supabase,
        file: selectedFile,
        tradeId,
        onProgress: setUploadProgress,
      });

      if (result.success && result.publicUrl && result.key) {
        // Success
        setSelectedFile(null);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
        onSuccess?.(result.publicUrl, result.key);
      } else {
        // Error
        const errorMessage = result.error || "Upload failed";
        setError(errorMessage);
        onError?.(errorMessage);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      onError?.(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    setSelectedFile(null);
    setError(null);
    setUploadProgress(0);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="r2-upload-form">
      <style jsx>{`
        .r2-upload-form {
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          padding: 20px;
          max-width: 500px;
          margin: 0 auto;
          background: #fff;
        }

        .form-section {
          margin-bottom: 16px;
        }

        .form-label {
          display: block;
          margin-bottom: 8px;
          font-weight: 500;
          color: #1f2937;
          font-size: 14px;
        }

        .file-input {
          display: block;
          width: 100%;
          padding: 8px;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          font-size: 14px;
          cursor: pointer;
        }

        .file-input:hover {
          border-color: #9ca3af;
        }

        .file-info {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-top: 12px;
          padding: 12px;
          background: #f9fafb;
          border-radius: 6px;
          font-size: 13px;
          color: #6b7280;
        }

        .file-name {
          font-weight: 500;
          color: #1f2937;
          word-break: break-all;
        }

        .progress-bar {
          width: 100%;
          height: 6px;
          background: #e5e7eb;
          border-radius: 3px;
          overflow: hidden;
          margin-top: 12px;
        }

        .progress-fill {
          height: 100%;
          background: #3b82f6;
          transition: width 0.2s;
        }

        .progress-text {
          margin-top: 6px;
          font-size: 12px;
          color: #6b7280;
          text-align: right;
        }

        .buttons {
          display: flex;
          gap: 8px;
          margin-top: 16px;
        }

        button {
          flex: 1;
          padding: 10px 16px;
          border-radius: 6px;
          border: none;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }

        .btn-upload {
          background: #3b82f6;
          color: white;
        }

        .btn-upload:hover:not(:disabled) {
          background: #2563eb;
        }

        .btn-upload:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .btn-cancel {
          background: #e5e7eb;
          color: #374151;
        }

        .btn-cancel:hover {
          background: #d1d5db;
        }

        .error-message {
          padding: 12px;
          background: #fee2e2;
          border: 1px solid #fca5a5;
          border-radius: 6px;
          color: #991b1b;
          font-size: 13px;
          margin-bottom: 16px;
        }

        .success-icon {
          color: #059669;
          font-size: 20px;
        }
      `}</style>

      {error && <div className="error-message">⚠️ {error}</div>}

      <div className="form-section">
        <label className="form-label">Select Trading Image</label>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={handleFileSelect}
          disabled={isLoading}
          className="file-input"
        />
        <small style={{ color: "#6b7280", marginTop: "6px", display: "block" }}>
          Supported formats: PNG, JPG, WebP (Max 10MB)
        </small>
      </div>

      {selectedFile && (
        <div className="form-section">
          <div className="file-info">
            <div className="file-name">{selectedFile.name}</div>
            <div>{formatFileSize(selectedFile.size)}</div>
          </div>

          {isLoading && (
            <>
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              <div className="progress-text">{Math.round(uploadProgress)}%</div>
            </>
          )}

          <div className="buttons">
            <button
              className="btn-upload"
              onClick={handleUpload}
              disabled={isLoading}
            >
              {isLoading ? "Uploading..." : "Upload to R2"}
            </button>
            <button
              className="btn-cancel"
              onClick={handleCancel}
              disabled={isLoading}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {!selectedFile && !isLoading && (
        <div
          style={{
            textAlign: "center",
            padding: "24px",
            color: "#9ca3af",
            fontSize: "13px",
          }}
        >
          Click above to select a trading screenshot
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// USAGE EXAMPLE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Usage in a page component:
 *
 * import { R2UploadForm } from "@/components/R2UploadForm";
 *
 * export default function TradePage({ tradeId }: { tradeId: string }) {
 *   const [imageUrl, setImageUrl] = useState<string | null>(null);
 *
 *   const handleUploadSuccess = async (publicUrl: string, key: string) => {
 *     // Store image URL in database
 *     const { error } = await supabase
 *       .from("trades")
 *       .update({
 *         image_url: publicUrl,
 *         image_key: key,
 *       })
 *       .eq("id", tradeId);
 *
 *     if (!error) {
 *       setImageUrl(publicUrl);
 *       // Show success toast
 *     }
 *   };
 *
 *   return (
 *     <div>
 *       <h1>Upload Trade Screenshot</h1>
 *       <R2UploadForm
 *         tradeId={tradeId}
 *         onSuccess={handleUploadSuccess}
 *         onError={(error) => console.error("Upload error:", error)}
 *       />
 *       {imageUrl && (
 *         <div style={{ marginTop: 20 }}>
 *           <h2>Preview</h2>
 *           <img src={imageUrl} alt="Trade screenshot" style={{ maxWidth: "100%" }} />
 *         </div>
 *       )}
 *     </div>
 *   );
 * }
 */
