import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import MobileDemo from './MobileDemo';
import '../theme';
import '../design-system.css';
import '../styles.css';
import '../editorial.css';
import './demo.css';
import './mobile-demo.css';

const root=document.getElementById('root');
if(root)createRoot(root).render(<StrictMode><MobileDemo/></StrictMode>);
