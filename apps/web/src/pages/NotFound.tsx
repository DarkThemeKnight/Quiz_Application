import { Link } from 'react-router';
import { EmptyState, useDocumentTitle } from '../components/ui';

export function NotFoundPage() {
  useDocumentTitle('Not found');
  return (
    <div className="page card">
      <EmptyState
        title="Page not found"
        actions={
          <Link to="/" className="btn btn-primary">
            Go to overview
          </Link>
        }
      >
        The page you were looking for does not exist.
      </EmptyState>
    </div>
  );
}
