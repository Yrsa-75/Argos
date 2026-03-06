// ============================================================
// ARGOS — Client Supabase
// ============================================================
import { createClient, RealtimeChannel } from '@supabase/supabase-js';
import type { Job, Clip, Subtitle, Chapter, JobStatus, JobConfig } from '../types/argos';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Variables Supabase manquantes dans .env');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// ----------------------------------------------------------------
// Auth helpers
// ----------------------------------------------------------------

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

// ----------------------------------------------------------------
// Jobs
// ----------------------------------------------------------------

export async function createJob(
  title: string,
  config: JobConfig,
  userId: string
): Promise<Job> {
  const { data, error } = await supabase
    .from('jobs')
    .insert({ title, config, user_id: userId, status: 'pending' })
    .select()
    .single();

  if (error) throw error;
  return data as Job;
}

export async function getJobs(userId: string): Promise<Job[]> {
  const { data, error } = await supabase
    .from('jobs')
    .select(`
      *,
      clips (
        *,
        subtitles (*)
      ),
      chapters (*)
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data as Job[]) ?? [];
}

export async function getJob(jobId: string): Promise<Job> {
  const { data, error } = await supabase
    .from('jobs')
    .select(`
      *,
      clips (
        *,
        subtitles (*)
      ),
      chapters (*)
    `)
    .eq('id', jobId)
    .single();

  if (error) throw error;
  return data as Job;
}

// ----------------------------------------------------------------
// Realtime — Écoute les mises à jour d'un job en temps réel
// Retourne une fonction de cleanup à appeler dans useEffect
// ----------------------------------------------------------------

export function subscribeToJob(
  jobId: string,
  onUpdate: (job: Job) => void
): () => void {
  const channel: RealtimeChannel = supabase
    .channel(`job-${jobId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'jobs',
        filter: `id=eq.${jobId}`,
      },
      (payload) => {
        onUpdate(payload.new as Job);
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

export function subscribeToUserJobs(
  userId: string,
  onInsert: (job: Job) => void,
  onUpdate: (job: Job) => void
): () => void {
  const channel: RealtimeChannel = supabase
    .channel(`user-jobs-${userId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'jobs',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => onInsert(payload.new as Job)
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'jobs',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => onUpdate(payload.new as Job)
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

// ----------------------------------------------------------------
// Clips — Écoute les nouveaux clips d'un job
// ----------------------------------------------------------------

export function subscribeToClips(
  jobId: string,
  onInsert: (clip: Clip) => void
): () => void {
  const channel: RealtimeChannel = supabase
    .channel(`clips-${jobId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'clips',
        filter: `job_id=eq.${jobId}`,
      },
      (payload) => onInsert(payload.new as Clip)
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
