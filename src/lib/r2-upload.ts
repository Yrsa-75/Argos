// ============================================================
// ARGOS — Upload direct vers Cloudflare R2
//
// Flow d'upload (pour les gros fichiers sans passer par un serveur) :
// 1. Frontend demande une presigned URL au Worker Railway
// 2. Frontend upload directement en PUT vers R2
// 3. Worker reçoit l'URL finale et démarre le pipeline
// ============================================================

export interface UploadProgress {
  percent: number;
  loaded: number;
  total: number;
  speed: number;  // bytes/sec
  eta: number;    // secondes restantes estimées
}

export interface PresignedUrlResponse {
  uploadUrl: string;   // URL PUT signée R2
  publicUrl: string;   // URL publique finale du fichier
  key: string;         // Clé dans le bucket
}

// ----------------------------------------------------------------
// Demander une presigned URL au worker
// ----------------------------------------------------------------

export async function getPresignedUploadUrl(
  filename: string,
  fileSize: number,
  mimeType: string
): Promise<PresignedUrlResponse> {
  const workerUrl = import.meta.env.VITE_WORKER_URL as string;
  const token = import.meta.env.VITE_WORKER_SECRET_TOKEN as string;

  const response = await fetch(`${workerUrl}/api/upload/presign`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ filename, fileSize, mimeType }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Impossible d'obtenir l'URL d'upload : ${err}`);
  }

  return response.json();
}

// ----------------------------------------------------------------
// Upload avec suivi de progression
// ----------------------------------------------------------------

export async function uploadToR2(
  file: File,
  presignedUrl: string,
  onProgress?: (progress: UploadProgress) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const startTime = Date.now();

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && onProgress) {
        const elapsed = (Date.now() - startTime) / 1000;
        const speed = event.loaded / elapsed;
        const remaining = event.total - event.loaded;
        const eta = speed > 0 ? remaining / speed : 0;

        onProgress({
          percent: Math.round((event.loaded / event.total) * 100),
          loaded: event.loaded,
          total: event.total,
          speed,
          eta,
        });
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload échoué : HTTP ${xhr.status}`));
      }
    });

    xhr.addEventListener('error', () => {
      reject(new Error('Erreur réseau pendant l\'upload'));
    });

    xhr.addEventListener('abort', () => {
      reject(new Error('Upload annulé'));
    });

    xhr.open('PUT', presignedUrl);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.send(file);
  });
}

// ----------------------------------------------------------------
// Fonction principale : presign + upload + retourne l'URL publique
// ----------------------------------------------------------------

export async function uploadVideo(
  file: File,
  onProgress?: (progress: UploadProgress) => void
): Promise<string> {
  // Validation
  const maxSize = 4 * 1024 * 1024 * 1024; // 4 GB
  if (file.size > maxSize) {
    throw new Error('Le fichier dépasse la limite de 4 GB');
  }

  const allowedTypes = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm'];
  if (!allowedTypes.includes(file.type)) {
    throw new Error('Format non supporté. Utilise MP4, MOV, AVI ou WebM');
  }

  // 1. Obtenir la presigned URL
  const { uploadUrl, publicUrl } = await getPresignedUploadUrl(
    file.name,
    file.size,
    file.type
  );

  // 2. Upload direct vers R2
  await uploadToR2(file, uploadUrl, onProgress);

  // 3. Retourner l'URL publique R2
  return publicUrl;
}

// ----------------------------------------------------------------
// Utilitaires d'affichage
// ----------------------------------------------------------------

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function formatSpeed(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}

export function formatEta(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${minutes}m${secs.toString().padStart(2, '0')}s`;
}
