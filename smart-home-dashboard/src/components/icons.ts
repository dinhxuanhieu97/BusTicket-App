import {
  Armchair, Baby, BedDouble, ChefHat, DoorOpen, Film, Focus, Laptop, Lightbulb, Moon, Plug, ShieldCheck, Sunrise, Thermometer, Trees, Tv, Utensils,
  type LucideIcon,
} from 'lucide-react';
import type { DeviceCategory, Room, Scene } from '../data/mock';

export const roomIcons: Record<Room['icon'], LucideIcon> = { sofa: Armchair, chef: ChefHat, bed: BedDouble, laptop: Laptop, baby: Baby, trees: Trees };
export const sceneIcons: Record<Scene['icon'], LucideIcon> = { sunrise: Sunrise, focus: Focus, film: Film, utensils: Utensils, door: DoorOpen, moon: Moon };
export const categoryIcons: Record<DeviceCategory, LucideIcon> = { light: Lightbulb, climate: Thermometer, media: Tv, plug: Plug, security: ShieldCheck };
export const categoryLabels: Record<DeviceCategory, string> = { light: 'Chiếu sáng', climate: 'Khí hậu', media: 'Giải trí', plug: 'Ổ cắm & máy', security: 'An ninh' };
export const sceneTones: Record<Scene['tone'], string> = {
  amber: 'bg-amber-400/20 text-amber-500 dark:text-amber-300',
  blue: 'bg-sky-400/20 text-sky-600 dark:text-sky-300',
  violet: 'bg-violet-400/20 text-violet-600 dark:text-violet-300',
  rose: 'bg-rose-400/20 text-rose-600 dark:text-rose-300',
  slate: 'bg-slate-400/20 text-slate-600 dark:text-slate-300',
  teal: 'bg-teal-400/20 text-teal-600 dark:text-teal-300',
};
