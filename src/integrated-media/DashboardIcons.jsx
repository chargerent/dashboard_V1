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

export function DashboardIcon({name,size=20,...props}) {
  const Component=ICONS[name] || InformationCircleIcon;
  return <Component width={size} height={size} aria-hidden="true" {...props}/>;
}
