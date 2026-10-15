import {createRoot} from 'react-dom/client';
import UiProfilesPage from '../../src/pages/UiProfilesPage.jsx';
import '../../src/index.css';

// Actual profile page with its isolated in-memory API; never contacts live stations.
createRoot(document.getElementById('root')).render(<UiProfilesPage previewMode
  currentUser={{isAdmin: true, username: 'local-preview'}}
  initialClientId="MIXED SAMPLE" initialSection="chargerentApp"
  onLogout={() => {}} onNavigateToAdmin={() => {}} onNavigateToDashboard={() => {}} t={(key) => key} />);
