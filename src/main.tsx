import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './editorial.css';
const element=document.getElementById('root');
if(element)createRoot(element).render(<StrictMode><App/></StrictMode>);
