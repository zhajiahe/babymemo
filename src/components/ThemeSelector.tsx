import {Monitor, Moon, Sun} from 'lucide-react';
import {SegmentedControl} from './ui';
import {setThemePreference, useThemePreference, type ThemePreference} from '../theme';

const options = [
 {value:'system' as const,label:'跟随系统',icon:<Monitor size={16}/>},
 {value:'light' as const,label:'浅色',icon:<Sun size={16}/>},
 {value:'dark' as const,label:'深色',icon:<Moon size={16}/>}
];

export function ThemeSelector({compact=false}:{compact?:boolean}) {
 const preference = useThemePreference();
 return <div className={'theme-setting'+(compact?' theme-setting--compact':'')}>
  <SegmentedControl<ThemePreference> className="theme-switch" label="外观主题" value={preference} onChange={setThemePreference} options={options}/>
  {!compact&&<p className="muted small theme-help">跟随系统会在设备切换深浅外观时自动更新。个人外观偏好只保存在这台设备上，不影响其他家庭成员。</p>}
 </div>;
}
