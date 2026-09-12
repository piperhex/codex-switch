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

/** Verify real multitouch changes image pixels while keeping the preview open. */
public final class ImageGestureTest extends UiAutomatorTestCase {
    private static final int GESTURE_STEPS = 40;
    private static final int PIXEL_STEP = 8;
    private static final int MIN_CHANGED_PIXELS = 100;

    public void testPinch() throws Exception {
        Configurator.getInstance().setWaitForIdleTimeout(0);
        UiObject image = new UiObject(new UiSelector().description(getParams().getString("label")));
        Rect bounds = image.getBounds();
        File before = new File("/data/local/tmp/image-before.png");
        File after = new File("/data/local/tmp/image-after.png");
        assertTrue(getUiDevice().takeScreenshot(before));
        String direction = getParams().getString("direction");
        if ("edges".equals(direction)) {
            verifyEdgeGestures(image, bounds);
        } else {
            assertTrue("in".equals(direction) ? image.pinchIn(70, GESTURE_STEPS)
                : image.pinchOut(70, GESTURE_STEPS));
        }
        Thread.sleep(500);
        assertTrue(new UiObject(new UiSelector().description("保存到相册")).exists());
        assertTrue(getUiDevice().takeScreenshot(after));
        Bitmap original = BitmapFactory.decodeFile(before.getPath());
        Bitmap changed = BitmapFactory.decodeFile(after.getPath());
        int differences = 0;
        for (int y = Math.max(0, bounds.top); y < Math.min(original.getHeight(), bounds.bottom); y += PIXEL_STEP) {
            for (int x = Math.max(0, bounds.left); x < Math.min(original.getWidth(), bounds.right); x += PIXEL_STEP) {
                if (original.getPixel(x, y) != changed.getPixel(x, y)) differences++;
            }
        }
        original.recycle();
        changed.recycle();
        assertTrue("Pinching must visibly change the image", differences > MIN_CHANGED_PIXELS);
    }

    private void verifyEdgeGestures(UiObject image, Rect bounds) throws Exception {
        UiObject save = new UiObject(new UiSelector().description("保存到相册"));
        Rect button = save.getBounds();
        int width = getUiDevice().getDisplayWidth();
        int height = getUiDevice().getDisplayHeight();
        int edge = PIXEL_STEP * 2;
        assertEquals("The image reaches the top of the screen", 0, bounds.top);
        assertTrue("The image extends below the save button", bounds.bottom > button.bottom);
        assertTrue("The image reaches the bottom of the screen", bounds.bottom >= height - 1);
        // One finger starts in the footer; both travel beyond the old image stage.
        assertTrue(image.performTwoPointerGesture(new Point(width / 3, button.centerY()),
            new Point(width / 2, button.top - button.height()), new Point(width / 3, height - edge),
            new Point(width / 2, edge), GESTURE_STEPS));
        assertTrue("Pinching from the footer keeps the preview open", save.exists());
        // An image drag can cross the save button without becoming a button press or dismissal.
        assertTrue(getUiDevice().swipe(button.centerX(), height / 2, button.centerX(),
            button.bottom + edge, GESTURE_STEPS));
        assertTrue("Dragging across the save button keeps the preview open", save.exists());
        assertTrue(getUiDevice().swipe(width / 4, button.centerY(), width / 4,
            height / 2, GESTURE_STEPS));
        assertTrue("Dragging from the footer keeps the preview open", save.exists());
        assertTrue(getUiDevice().swipe(width / 4, height / 3, width / 4, edge, GESTURE_STEPS));
        assertTrue("Dragging above the image keeps the preview open", save.exists());
    }
}
