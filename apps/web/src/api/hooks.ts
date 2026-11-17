import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import type {
  AnalyticsDto,
  AnalyticsRange,
  CollectionDto,
  DashboardDto,
  Me,
  Paginated,
  QuestionDetailDto,
  QuestionStatsDto,
  QuestionSummaryDto,
  SessionCreateInput,
  SessionDto,
  SessionResultDto,
  SessionSummaryDto,
  SubjectDto,
  TagDto,
  TopicDto,
} from '@recall/shared';
import { api, qs } from './client';

export const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

export const keys = {
  status: ['auth', 'status'] as const,
  me: ['auth', 'me'] as const,
  subjects: ['subjects'] as const,
  topics: ['topics'] as const,
  collections: ['collections'] as const,
  tags: ['tags'] as const,
  questions: ['questions'] as const,
  question: (id: string) => ['questions', 'detail', id] as const,
  stats: ['questions', 'stats'] as const,
  dashboard: ['dashboard'] as const,
  analytics: ['analytics'] as const,
  sessions: ['sessions'] as const,
  session: (id: string) => ['sessions', 'detail', id] as const,
  result: (id: string) => ['sessions', 'result', id] as const,
};

export function useAuthStatus() {
  return useQuery({
    queryKey: keys.status,
    queryFn: () => api.get<{ ownerConfigured: boolean; authenticated: boolean }>('/auth/status'),
    retry: false,
  });
}

export function useMe(enabled = true) {
  return useQuery({
    queryKey: keys.me,
    queryFn: () => api.get<Me>('/auth/me'),
    enabled,
    retry: false,
    staleTime: 60_000,
  });
}

export const useSubjects = () =>
  useQuery({ queryKey: keys.subjects, queryFn: () => api.get<SubjectDto[]>('/subjects') });
export const useTopics = () =>
  useQuery({ queryKey: keys.topics, queryFn: () => api.get<TopicDto[]>('/topics') });
export const useCollections = () =>
  useQuery({ queryKey: keys.collections, queryFn: () => api.get<CollectionDto[]>('/collections') });
export const useTags = () =>
  useQuery({ queryKey: keys.tags, queryFn: () => api.get<TagDto[]>('/tags') });

export interface QuestionFilters {
  q?: string;
  subjectId?: string;
  topicId?: string;
  collectionId?: string;
  tag?: string;
  kind?: string;
  difficulty?: string;
  status?: string;
  reviewStatus?: string;
  page?: number;
  pageSize?: number;
}

export function useQuestions(filters: QuestionFilters) {
  return useQuery({
    queryKey: [...keys.questions, 'list', filters],
    queryFn: () => api.get<Paginated<QuestionSummaryDto>>(`/questions${qs({ ...filters })}`),
    placeholderData: (prev) => prev,
  });
}

export const useQuestion = (id: string | undefined) =>
  useQuery({
    queryKey: keys.question(id ?? ''),
    queryFn: () => api.get<QuestionDetailDto>(`/questions/${id}`),
    enabled: !!id,
  });

export const useQuestionStats = () =>
  useQuery({ queryKey: keys.stats, queryFn: () => api.get<QuestionStatsDto>('/questions/stats') });

export const useDashboard = () =>
  useQuery({
    queryKey: keys.dashboard,
    queryFn: () => api.get<DashboardDto>(`/dashboard${qs({ tz: timeZone })}`),
  });

export function useAnalytics(range: AnalyticsRange, subjectId: string, mode: string) {
  return useQuery({
    queryKey: [...keys.analytics, range, subjectId, mode],
    queryFn: () =>
      api.get<AnalyticsDto>(`/analytics${qs({ range, subjectId, mode, tz: timeZone })}`),
    placeholderData: (prev) => prev,
  });
}

export function useHistory(filters: { mode?: string; status?: string; page: number }) {
  return useQuery({
    queryKey: [...keys.sessions, 'list', filters],
    queryFn: () =>
      api.get<Paginated<SessionSummaryDto>>(`/sessions${qs({ ...filters, pageSize: 20 })}`),
    placeholderData: (prev) => prev,
  });
}

export const useSession = (id: string) =>
  useQuery({
    queryKey: keys.session(id),
    queryFn: () => api.get<SessionDto>(`/sessions/${id}`),
    refetchOnWindowFocus: false,
  });

export const useResult = (id: string) =>
  useQuery({
    queryKey: keys.result(id),
    queryFn: () => api.get<SessionResultDto>(`/sessions/${id}/result`),
    retry: false,
  });

/** Anything that changes study data invalidates the derived views. */
export function invalidateStudyData(client: QueryClient): Promise<void> {
  return Promise.all([
    client.invalidateQueries({ queryKey: keys.dashboard }),
    client.invalidateQueries({ queryKey: keys.analytics }),
    client.invalidateQueries({ queryKey: keys.sessions }),
  ]).then(() => undefined);
}

export function invalidateBank(client: QueryClient): Promise<void> {
  return Promise.all(
    [keys.questions, keys.subjects, keys.topics, keys.collections, keys.tags, keys.dashboard].map(
      (k) => client.invalidateQueries({ queryKey: k }),
    ),
  ).then(() => undefined);
}

/** Create a session and open the runner — used by every "start practising" shortcut. */
export function useStartSession() {
  const client = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: (input: SessionCreateInput) => api.post<SessionDto>('/sessions', input),
    onSuccess: (session) => {
      client.setQueryData(keys.session(session.id), session);
      void invalidateStudyData(client);
      void navigate(`/session/${session.id}`);
    },
  });
}
