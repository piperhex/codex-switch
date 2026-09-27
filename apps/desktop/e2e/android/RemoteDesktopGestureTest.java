package dev.codexswitch.testing;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Point;
import android.graphics.Rect;
import com.android.uiautomator.core.Configurator;
import com.android.uiautomator.core.UiObject;
import com.android.uiautomator.core.UiSelector;
import com.android.uiautomator.testrunner.UiAutomatorTestCase;
import java.io.File;

/** Exercise native multitouch outside the mouse controls against the live video fixture. */
public final class RemoteDesktopGestureTest extends UiAutomatorTestCase {
    private static final int GESTURE_STEPS = 35;
    private static final int PIXEL_STEP = 8;

    public void testModeAndKeyboardLayout() throws Exception {
        Configurator.getInstance().setWaitForIdleTimeout(0);
        UiObject toTouch = control("切换为触屏模式");
        UiObject toMouse = control("切换为鼠标模式");
        assertTrue(toTouch.waitForExists(3000)); assertFalse(toMouse.exists());
        assertTrue(toTouch.click()); assertTrue(toMouse.waitForExists(3000));
        assertFalse(control("鼠标左键").exists()); assertFalse(control("展开鼠标面板").exists());
        assertTrue(toMouse.click()); assertTrue(control("鼠标左键").waitForExists(3000));
        assertTrue(control("键盘").click());
        UiObject editor = control("发送到电脑的文字");
        assertTrue(editor.waitForExists(3000));
        UiObject stage = control("远程桌面触控区域");
        for (int attempt = 0; attempt < 30 && stage.getBounds().bottom >= getUiDevice().getDisplayHeight(); attempt++) {
            Thread.sleep(100);
        }
        Rect available = stage.getBounds(); Rect input = editor.getBounds();
        assertTrue("Keyboard reduces the usable stage", available.bottom < getUiDevice().getDisplayHeight());
        assertTrue("Input is fully below the top edge", input.top > available.top);
        assertTrue("Input stays above the keyboard", input.bottom <= available.bottom);
        assertFalse("Stats do not overlap text entry", control("关闭连接状态").exists());
        assertTrue(getUiDevice().takeScreenshot(new File("/data/local/tmp/desktop-keyboard.png")));
        assertTrue(new UiObject(new UiSelector().text("收起")).click());
        assertTrue(editor.waitUntilGone(3000));
        for (int attempt = 0; attempt < 30 && stage.getBounds().bottom < getUiDevice().getDisplayHeight(); attempt++) {
            Thread.sleep(100);
        }
        assertEquals("Dismissing input restores the full stage", getUiDevice().getDisplayHeight(), stage.getBounds().bottom);
        assertTrue(control("关闭连接状态").waitForExists(3000));
    }

    private UiObject control(String description) { return new UiObject(new UiSelector().description(description)); }

    public void testLandscapePinch() throws Exception {
        Configurator.getInstance().setWaitForIdleTimeout(0);
        UiObject fullscreenHint = new UiObject(new UiSelector().text("Got it"));
        if (fullscreenHint.waitForExists(2000)) fullscreenHint.click();
        UiObject stage = new UiObject(new UiSelector().description("远程桌面触控区域"));
        Rect bounds = stage.getBounds();
        assertEquals("Stage reaches the top", 0, bounds.top);
        assertEquals("Stage reaches the bottom", getUiDevice().getDisplayHeight(), bounds.bottom);
        File before = new File("/data/local/tmp/desktop-before-pinch.png");
        File after = new File("/data/local/tmp/desktop-after-pinch.png");
        assertTrue(getUiDevice().takeScreenshot(before));
        int y = bounds.top + bounds.height() / 4;
        int x = bounds.left;
        int width = bounds.width();
        assertTrue(stage.performTwoPointerGesture(new Point(x + width / 5, y),
            new Point(x + width * 2 / 5, y), new Point(x + width / 10, y),
            new Point(x + width / 2, y), GESTURE_STEPS));
        Thread.sleep(500);
        assertTrue(getUiDevice().takeScreenshot(after));
        Bitmap original = BitmapFactory.decodeFile(before.getPath());
        Bitmap zoomed = BitmapFactory.decodeFile(after.getPath());
        int changes = differences(original, zoomed, bounds);
        assertTrue("Pinch visibly enlarges the desktop", changes > 100);
        assertStableAfterMouseMove(zoomed, bounds);
        zoomed.recycle();
        assertTrue(stage.performTwoPointerGesture(new Point(x + width / 10, y),
            new Point(x + width / 2, y), new Point(x + width * 29 / 100, y),
            new Point(x + width * 31 / 100, y), GESTURE_STEPS));
        Thread.sleep(500);
        File restoredFile = new File("/data/local/tmp/desktop-restored-pinch.png");
        assertTrue(getUiDevice().takeScreenshot(restoredFile));
        Bitmap restored = BitmapFactory.decodeFile(restoredFile.getPath());
        assertTrue("Pinching from the stats text restores the fitted picture",
            differences(original, restored, bounds) < changes / 2);
        original.recycle();
        restored.recycle();
    }

    private void assertStableAfterMouseMove(Bitmap zoomed, Rect bounds) throws Exception {
        int x = bounds.left + bounds.width() * 3 / 4;
        int y = bounds.height() / 8;
        assertTrue(getUiDevice().swipe(x, y, x + 60, y, GESTURE_STEPS));
        Thread.sleep(1200);
        File file = new File("/data/local/tmp/desktop-stable-zoom.png");
        assertTrue(getUiDevice().takeScreenshot(file));
        Bitmap stable = BitmapFactory.decodeFile(file.getPath());
        assertTrue("Mouse movement and idle updates must not shift the zoomed picture",
            differences(zoomed, stable, bounds) < 100);
        stable.recycle();
    }

    private int differences(Bitmap original, Bitmap current, Rect bounds) {
        assertEquals("Screen orientation stays stable during the gesture", original.getWidth(), current.getWidth());
        assertEquals("Screen orientation stays stable during the gesture", original.getHeight(), current.getHeight());
        int changed = 0;
        // Exclude stats, moving mouse controls and the fixture's animated strip; tolerate codec noise.
        for (int y = bounds.height() / 2; y < bounds.height() * 4 / 5; y += PIXEL_STEP) {
            for (int x = bounds.left + bounds.width() / 10;
                    x < bounds.left + bounds.width() * 3 / 5; x += PIXEL_STEP) {
                int before = original.getPixel(x, y);
                int after = current.getPixel(x, y);
                int delta = Math.abs(((before >> 16) & 255) - ((after >> 16) & 255))
                    + Math.abs(((before >> 8) & 255) - ((after >> 8) & 255))
                    + Math.abs((before & 255) - (after & 255));
                if (delta > 60) changed++;
            }
        }
        return changed;
    }
}
