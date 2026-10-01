export { Button, buttonVariants, type ButtonProps } from "./button";
export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent } from "./card";
export { Input, type InputProps } from "./input";
export { Label } from "./label";
export { cn } from "./utils";
export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator
} from "./select";
export { Textarea, type TextareaProps } from "./textarea";
export { Badge, badgeVariants, type BadgeProps } from "./badge";
export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "./dialog";
export {
  useFormField,
  Form,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
  FormField,
} from "./form";
export { Alert, AlertTitle, AlertDescription } from "./alert";
export { Progress } from "./progress";
export { Tabs, TabsList, TabsTrigger, TabsContent } from "./tabs";
export { Separator } from "./separator";
export { Checkbox } from "./checkbox";
export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
} from "./table";

// Briques des écrans d'administration v2 (états, champs, tableau responsive, confirmation)
export * from "./admin";

// Schedule Generation Components
export { WeeklyScheduleGrid, type ScheduleSession } from "./components/WeeklyScheduleGrid";
export { TimeSlotPicker, type TimeSlot } from "./components/TimeSlotPicker";
export { CourseSelector, type Course, type SelectedCourse } from "./components/CourseSelector";

// RSO Components
export { TagBadge } from "./components/rso/TagBadge";

// Notifications
export { NotificationBell, type NotificationItem, type NotificationBellProps } from "./components/NotificationBell";

// Live session room (LiveKit)
export {
  LiveSessionRoom,
  type LiveSessionRoomProps,
  type LiveSessionRole,
  type LiveSessionTokenResponse,
} from "./components/LiveSessionRoom";
// Note: SearchAutocomplete, TagSelector, and NotificationWidget are in apps/web
// and cannot be exported from packages/ui due to circular dependency issues.
// Import them directly from apps/web/src/components/rso/











