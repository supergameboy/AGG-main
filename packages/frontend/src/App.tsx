import { lazy, Suspense } from 'react';
import {
  createBrowserRouter,
  Navigate,
} from 'react-router-dom';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { LoadingScreen } from '@/components/common/LoadingScreen';
import { AppLayout } from '@/components/layout/AppLayout';
import { NavigationGuard } from '@/components/common/NavigationGuard';

const MainMenu = lazy(() => import('@/pages/MainMenu'));
const TemplateSelect = lazy(() => import('@/pages/TemplateSelect'));
const CharacterCreate = lazy(() => import('@/pages/CharacterCreate'));
const Game = lazy(() => import('@/pages/Game'));
const Settings = lazy(() => import('@/pages/Settings'));
const Showcase = lazy(() => import('@/pages/Showcase'));
const Templates = lazy(() => import('@/pages/Templates'));
const TemplateEditor = lazy(() => import('@/pages/TemplateEditor'));
const TemplateDetail = lazy(() => import('@/pages/TemplateDetail'));
const AgentProfiles = lazy(() => import('@/pages/AgentProfiles'));
const AgentProfileDetail = lazy(() => import('@/pages/AgentProfileDetail'));
const AgentProfileForm = lazy(() => import('@/pages/AgentProfileForm'));
const PoolEditor = lazy(() => import('@/pages/PoolEditor'));

const withSuspense = (Component: React.LazyExoticComponent<() => JSX.Element>) => (
  <Suspense fallback={<LoadingScreen />}>
    <Component />
  </Suspense>
);

export function createRouter() {
  return createBrowserRouter([
    {
      path: '/',
      element: <MainMenu />,
      errorElement: <ErrorBoundary><div className="flex h-screen items-center justify-center"><p>页面不存在</p></div></ErrorBoundary>,
    },
    {
      element: <AppLayout />,
      children: [
        {
          path: 'select-template',
          element: withSuspense(TemplateSelect),
        },
        {
          path: 'create',
          element: withSuspense(CharacterCreate),
        },
        {
          path: 'game/:saveId?',
          element: (
            <NavigationGuard>
              {withSuspense(Game)}
            </NavigationGuard>
          ),
        },
        {
          path: 'settings',
          element: withSuspense(Settings),
        },
        {
          path: 'showcase',
          element: withSuspense(Showcase),
        },
        {
          path: 'templates',
          element: withSuspense(Templates),
        },
        {
          path: 'templates/:id/detail',
          element: withSuspense(TemplateDetail),
        },
        {
          path: 'templates/:id/edit',
          element: withSuspense(TemplateEditor),
        },
        {
          path: 'templates/:id/pool',
          element: withSuspense(PoolEditor),
        },
        {
          path: 'templates/:id',
          element: withSuspense(TemplateEditor),
        },
        {
          path: 'agent-profiles',
          element: withSuspense(AgentProfiles),
        },
        {
          path: 'agent-profiles/new',
          element: withSuspense(AgentProfileForm),
        },
        {
          path: 'agent-profiles/:name',
          element: withSuspense(AgentProfileDetail),
        },
      ],
    },
    {
      path: '*',
      element: <Navigate to="/" replace />,
    },
  ]);
}
