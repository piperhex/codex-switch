package dev.codexswitch.testing;

import com.android.uiautomator.core.Configurator;
import com.android.uiautomator.testrunner.UiAutomatorTestCase;
import android.os.Environment;
import java.io.File;

/** Read the current hierarchy during streamed updates; the shell dump command requires an idle screen. */
public final class HierarchyDump extends UiAutomatorTestCase {
    public void testDump() throws Exception {
        Configurator.getInstance().setWaitForIdleTimeout(0);
        File directory = new File(Environment.getDataDirectory(), "local/tmp");
        assertTrue(directory.isDirectory() || directory.mkdirs());
        File output = new File(directory, "chat-live.xml");
        assertTrue(!output.exists() || output.delete());
        for (int attempt = 0; attempt < 20 && !output.isFile(); attempt++) {
            getUiDevice().dumpWindowHierarchy("chat-live.xml");
            if (!output.isFile()) Thread.sleep(100);
        }
        assertTrue("A fresh hierarchy is required", output.isFile() && output.length() > 0);
    }
}
