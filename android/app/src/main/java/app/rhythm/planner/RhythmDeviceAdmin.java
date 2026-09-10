package app.rhythm.planner;

import android.app.admin.DeviceAdminReceiver;

/* The receiver `adb shell dpm set-device-owner` needs a name to point at.

   It does nothing and is meant to do nothing: device ownership here exists for
   exactly one capability — lock task mode that cannot be escaped by holding
   two buttons — and every other power it carries is left unused. A receiver
   with no policy attached is the smallest thing that can be provisioned.

   Nothing happens without the adb command. Declaring this does not make Rhythm
   a device owner, does not ask to become one, and has no effect on a normal
   install. */
public class RhythmDeviceAdmin extends DeviceAdminReceiver {
}
