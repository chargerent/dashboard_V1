// Use the same installed Heroicons outline set as the client dashboard.
import {
  ArrowDownIcon, ArrowPathIcon, ArrowRightIcon, ArrowTopRightOnSquareIcon,
  ArrowUpIcon, ArrowUpTrayIcon, ArrowUturnLeftIcon, ArrowsPointingOutIcon,
  Battery100Icon, BoltIcon, CameraIcon, ChatBubbleBottomCenterTextIcon,
  CheckCircleIcon, CheckIcon, ChevronDownIcon, ClockIcon, Cog6ToothIcon,
  ComputerDesktopIcon, ExclamationTriangleIcon, FolderIcon, ForwardIcon,
  HomeIcon, InformationCircleIcon, KeyIcon, LockClosedIcon, LockOpenIcon,
  LifebuoyIcon, MapPinIcon, PauseIcon, PencilSquareIcon, PhotoIcon, PlayIcon, PlusIcon,
  MagnifyingGlassIcon, PhoneIcon, QrCodeIcon, ArrowDownTrayIcon, CreditCardIcon,
  PowerIcon, RectangleGroupIcon, ShieldCheckIcon, SignalIcon, Squares2X2Icon,
  SunIcon, TrashIcon, WifiIcon, XMarkIcon,
} from '@heroicons/react/24/outline';

const ICONS = {
  returnSlot:ReturnSlotIcon,batteryCharging:BatteryChargingIcon,
  monitor:ComputerDesktopIcon, media:PhotoIcon, settings:Cog6ToothIcon,
  clock:ClockIcon, bolt:BoltIcon, play:PlayIcon, pause:PauseIcon, next:ForwardIcon,
  plus:PlusIcon, upload:ArrowUpTrayIcon, layout:RectangleGroupIcon, image:PhotoIcon,
  check:CheckIcon, checkCircle:CheckCircleIcon, arrow:ArrowRightIcon,
  back:ArrowUturnLeftIcon, down:ChevronDownIcon, close:XMarkIcon, trash:TrashIcon,
  message:ChatBubbleBottomCenterTextIcon, shield:ShieldCheckIcon, reload:ArrowPathIcon,
  wifi:WifiIcon, info:InformationCircleIcon, warning:ExclamationTriangleIcon,
  move:ArrowsPointingOutIcon, folder:FolderIcon, gear:Cog6ToothIcon, home:HomeIcon,
  recent:Squares2X2Icon, swipeUp:ArrowUpIcon, swipeDown:ArrowDownIcon,
  unlock:LockOpenIcon, lock:LockClosedIcon, capture:CameraIcon, open:ArrowTopRightOnSquareIcon,
  power:PowerIcon, text:PencilSquareIcon, location:MapPinIcon, signal:SignalIcon,
  battery:Battery100Icon, apps:Squares2X2Icon, display:SunIcon, key:KeyIcon,
  search:MagnifyingGlassIcon, phone:PhoneIcon, qr:QrCodeIcon, download:ArrowDownTrayIcon, card:CreditCardIcon, support:LifebuoyIcon,
};

// Lucide Import: the selected arrow entering an open return slot.
function ReturnSlotIcon(props){
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M12 3v12"/><path d="m8 11 4 4 4-4"/><path d="M8 5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-4"/></svg>;
}
function BatteryChargingIcon(props){
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M7 7H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h3M17 7h1a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-1M22 11v2"/><path d="m13 7-4 5h6l-4 5"/></svg>;
}

export function DashboardIcon({name,size=20,...props}) {
  const Component=ICONS[name] || InformationCircleIcon;
  return <Component width={size} height={size} aria-hidden="true" {...props}/>;
}
