import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import Demo from './Demo';
import '../styles.css';
import '../editorial.css';
import './demo.css';

const root=document.getElementById('root');
if(root)createRoot(root).render(<StrictMode><Demo/></StrictMode>);
