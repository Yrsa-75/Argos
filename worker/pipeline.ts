// ============================================================
// ARGOS Worker — Pipeline principal
//
// Orchestre le flow complet :
// download → transcription → analyse → découpe → traduction → export
// ============================================================
import { createClient } from '@supabase/supabase-js';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { pipeline as streamPipeline } from 'stream/promises';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { Job, Clip, JobStatus, LanguageCode } from '../src/types/argos';
import { transcribeVideo } from './transcribe';
import { analyzeVirality } from './analyze';
import { translateClip } from './translate';
import { cropVideo, cutClip, generateThumbnail, cleanupTempFiles } from './ffmpeg';

// ----------------------------------------------------------------
// Clients Supabase (service role — bypasse RLS)
// ----------------------------------------------------------------
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ----------------------------------------------------------------
// Client R2 (compatible S3)
// ----------------------------------------------------------------
const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY!,
  },
});

const R2_BUCKET = process.env.CLOUDFLARE_R2_BUCKET_NAME!;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL!;

// ----------------------------------------------------------------
// Helpers R2
// ----------------------------------------------------------------
async function downloadFromR2(key: string, localPath: string): Promise<void> {
  const command = new GetObjectCommand({ Bucket: R2_BUCKET, Key: key });
  const response = await r2.send(command);

  const writeStream = fs.createWriteStream(localPath);
  await streamPipeline(response.Body as Readable, writeStream);
}

async function uploadToR2(localPath: string, key: string, mimeType: string): Promise<string> {
  const fileContent = fs.readFileSync(localPath);

  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: fileContent,
    ContentType: mimeType,
  }));

  return `${R2_PUBLIC_URL}/${key}`;
}

// ----------------------------------------------------------------
// Helpers Supabase
// ----------------------------------------------------------------
async function updateJobStatus(
  jobId: string,
  status: JobStatus,
  progress: number,
  extra?: Record<string, unknown>
): Promise<void> {
  await supabase.from('jobs').update({
    status,
    progress,
    ...extra,
  }).eq('id', jobId);

  console.log(`[Pipeline] Job ${jobId.slice(0, 8)} → ${status} (${progress}%)`);
}

async function saveClip(jobId: string, clipData: {
  title: string;
  start_time: number;
  end_time: number;
  viral_score: number;
  viral_reason: string;
  raw_url: string;
  thumbnail_url: string;
}): Promise<string> {
  const { data, error } = await supabase.from('clips').insert({
    job_id: jobId,
    ...clipData,
  }).select('id').single();

  if (error) throw error;
  return data.id;
}

async function saveSubtitle(
  clipId: string,
  language: LanguageCode,
  srtUrl: string,
  content: unknown[]
): Promise<void> {
  await supabase.from('subtitles').upsert({
    clip_id: clipId,
    language,
    srt_url: srtUrl,
    content,
  }, { onConflict: 'clip_id,language' });
}

// ----------------------------------------------------------------
// Pipeline principal
// ----------------------------------------------------------------
export async function processJob(job: Job): Promise<void> {
  const jobId = job.id;
  const config = job.config;
  const tempDir = path.join(os.tmpdir(), `argos_${jobId}`);
  const filesToCleanup: string[] = [];

  console.log(`\n${'='.repeat(60)}`);
  console.log(`[Pipeline] Démarrage job ${jobId.slice(0, 8)}: "${job.title}"`);
  console.log(`[Pipeline] Format: ${config.format}, Langues: ${config.languages.join(', ')}`);
  console.log(`${'='.repeat(60)}\n`);

  try {
    fs.mkdirSync(tempDir, { recursive: true });

    // ----------------------------------------------------------------
    // ÉTAPE 1 : Télécharger la vidéo source depuis R2
    // ----------------------------------------------------------------
    await updateJobStatus(jobId, 'transcribing', 10);

    if (!job.source_url) throw new Error('URL source manquante');

    const sourceKey = job.source_url.replace(`${R2_PUBLIC_URL}/`, '');
    const sourcePath = path.join(tempDir, 'source.mp4');

    console.log(`[Pipeline] Téléchargement vidéo source...`);
    await downloadFromR2(sourceKey, sourcePath);
    filesToCleanup.push(sourcePath);
    console.log(`[Pipeline] ✓ Vidéo téléchargée`);

    // ----------------------------------------------------------------
    // ÉTAPE 2 : Transcription OpenAI Whisper
    // ----------------------------------------------------------------
    await updateJobStatus(jobId, 'transcribing', 20);

    const transcript = await transcribeVideo(sourcePath);

    // Mettre à jour la durée dans Supabase
    await supabase.from('jobs').update({ duration: transcript.duration }).eq('id', jobId);

    // ----------------------------------------------------------------
    // ÉTAPE 3 : Analyse viralité + chapitres avec Claude
    // ----------------------------------------------------------------
    await updateJobStatus(jobId, 'analyzing', 40);

    const analysis = await analyzeVirality(transcript, job.title);

    // Sauvegarder les chapitres
    if (analysis.chapters.length > 0) {
      await supabase.from('chapters').insert(
        analysis.chapters.map(ch => ({ ...ch, job_id: jobId }))
      );
    }

    // ----------------------------------------------------------------
    // ÉTAPE 4 : Découpe et crop de chaque clip
    // ----------------------------------------------------------------
    await updateJobStatus(jobId, 'cutting', 55);

    const clipsProgress = analysis.clips.length;
    const clipIds: string[] = [];

    for (let i = 0; i < analysis.clips.length; i++) {
      const clipData = analysis.clips[i];
      const clipIndex = i + 1;

      console.log(`\n[Pipeline] Clip ${clipIndex}/${clipsProgress}: "${clipData.title}"`);

      // Découper le clip
      const rawClipPath = path.join(tempDir, `clip_${i}_raw.mp4`);
      await cutClip(sourcePath, rawClipPath, clipData.start_time, clipData.end_time);
      filesToCleanup.push(rawClipPath);

      // Crop au format souhaité
      const croppedClipPath = path.join(tempDir, `clip_${i}_cropped.mp4`);
      await cropVideo(rawClipPath, croppedClipPath, config.format);
      filesToCleanup.push(croppedClipPath);

      // Miniature
      const thumbnailPath = path.join(tempDir, `clip_${i}_thumb.jpg`);
      await generateThumbnail(croppedClipPath, thumbnailPath);
      filesToCleanup.push(thumbnailPath);

      // Upload vers R2
      const clipKey = `jobs/${jobId}/clips/clip_${i}_${config.format.replace(':', 'x')}.mp4`;
      const thumbKey = `jobs/${jobId}/clips/clip_${i}_thumb.jpg`;

      const rawUrl = await uploadToR2(croppedClipPath, clipKey, 'video/mp4');
      const thumbnailUrl = await uploadToR2(thumbnailPath, thumbKey, 'image/jpeg');

      // Sauvegarder le clip dans Supabase
      const clipId = await saveClip(jobId, {
        title: clipData.title,
        start_time: clipData.start_time,
        end_time: clipData.end_time,
        viral_score: clipData.viral_score,
        viral_reason: clipData.viral_reason,
        raw_url: rawUrl,
        thumbnail_url: thumbnailUrl,
      });

      clipIds.push(clipId);

      // Mise à jour progression
      const cuttingProgress = 55 + Math.round((clipIndex / clipsProgress) * 10);
      await updateJobStatus(jobId, 'cutting', cuttingProgress);
    }

    // ----------------------------------------------------------------
    // ÉTAPE 5 : Traduction + génération SRT
    // ----------------------------------------------------------------
    await updateJobStatus(jobId, 'translating', 65);

    const srtDir = path.join(tempDir, 'srt');
    fs.mkdirSync(srtDir, { recursive: true });

    for (let i = 0; i < analysis.clips.length; i++) {
      const clipData = analysis.clips[i];
      const clipId = clipIds[i];

      console.log(`\n[Pipeline] Traduction clip ${i + 1}/${analysis.clips.length}...`);

      const translations = await translateClip(
        clipId,
        transcript.words,
        clipData.start_time,
        clipData.end_time,
        transcript.language,
        config.languages as LanguageCode[],
        analysis.video_summary,
        srtDir
      );

      // Upload chaque SRT vers R2 + sauvegarder en DB
      for (const translation of translations) {
        const srtKey = `jobs/${jobId}/srt/clip_${i}_${translation.language}.srt`;
        const srtUrl = await uploadToR2(translation.srtPath, srtKey, 'text/plain');
        filesToCleanup.push(translation.srtPath);

        await saveSubtitle(clipId, translation.language, srtUrl, translation.words);
      }

      const translatingProgress = 65 + Math.round(((i + 1) / analysis.clips.length) * 20);
      await updateJobStatus(jobId, 'translating', translatingProgress);
    }

    // ----------------------------------------------------------------
    // ÉTAPE 6 : Terminé ✓
    // ----------------------------------------------------------------
    await updateJobStatus(jobId, 'done', 100);
    console.log(`\n[Pipeline] ✅ Job ${jobId.slice(0, 8)} terminé avec succès !`);

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`\n[Pipeline] ❌ Erreur job ${jobId.slice(0, 8)}:`, errorMessage);

    await supabase.from('jobs').update({
      status: 'error',
      progress: 0,
      error_message: errorMessage,
    }).eq('id', jobId);

    throw err;

  } finally {
    // Nettoyage des fichiers temporaires
    cleanupTempFiles(filesToCleanup);
    try { fs.rmdirSync(tempDir, { recursive: true }); } catch {}
    console.log(`[Pipeline] 🧹 Fichiers temporaires supprimés`);
  }
}
