package dev.codexswitch.testing;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Rect;
import com.android.uiautomator.core.Configurator;
import com.android.uiautomator.core.UiObject;
import com.android.uiautomator.core.UiSelector;
import com.android.uiautomator.testrunner.UiAutomatorTestCase;
import java.io.File;

/** Verify real multitouch changes image pixels while keeping the preview open. */
public final class ImageGestureTest extends UiAutomatorTestCase {
    public void testPinch() throws Exception {
        Configurator.getInstance().setWaitForIdleTimeout(0);
        UiObject image = new UiObject(new UiSelector().description(getParams().getString("label")));
        Rect bounds = image.getBounds();
        File before = new File("/data/local/tmp/image-before.png");
        File after = new File("/data/local/tmp/image-after.png");
        assertTrue(getUiDevice().takeScreenshot(before));
        boolean zoomOut = "in".equals(getParams().getString("direction"));
        assertTrue(zoomOut ? image.pinchIn(70, 40) : image.pinchOut(70, 40));
        Thread.sleep(500);
        assertTrue(new UiObject(new UiSelector().description("保存到相册")).exists());
        assertTrue(getUiDevice().takeScreenshot(after));
        Bitmap original = BitmapFactory.decodeFile(before.getPath());
        Bitmap changed = BitmapFactory.decodeFile(after.getPath());
        int differences = 0;
        for (int y = Math.max(0, bounds.top); y < Math.min(original.getHeight(), bounds.bottom); y += 8) {
            for (int x = Math.max(0, bounds.left); x < Math.min(original.getWidth(), bounds.right); x += 8) {
                if (original.getPixel(x, y) != changed.getPixel(x, y)) differences++;
            }
        }
        original.recycle();
        changed.recycle();
        assertTrue("Pinching must visibly change the image", differences > 100);
    }
}
