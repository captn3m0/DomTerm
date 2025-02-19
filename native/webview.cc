#include "webview.h"

webview::webview w(true, nullptr);

void close_main_window(const char *seq, const char *req, void *arg)
{
    exit(0);
}

void set_w_t(const char *seq, const char *req, void *arg)
{
    size_t rlen = strlen(req);
    // The req is a JSON list of a single string.
    // The +1 and -2 are to strip off the list delimiters '[' and ']'
    int jlen = webview::json_unescape(req+1, rlen-2, nullptr);
    char *tmp = new char[jlen+1];
    webview::json_unescape(req+1, rlen-2, tmp);
    w.set_title(tmp);
    delete[] tmp;
}

#ifdef WEBVIEW_GTK
void toggle_inspector(const char *seq, const char *req, void *arg)
{
    WebKitWebInspector *inspector = webkit_web_view_get_inspector (WEBKIT_WEB_VIEW(w.window()));
    if (true) { // FIXME
        // haven't gotten this working FIXME
        webkit_web_inspector_show (WEBKIT_WEB_INSPECTOR(inspector));
    } else {
        webkit_web_inspector_close (WEBKIT_WEB_INSPECTOR(inspector));
    }
}
#endif

#ifdef WIN32
int WINAPI WinMain(HINSTANCE hInt, HINSTANCE hPrevInst, LPSTR lpCmdLine,
                   int nCmdShow) {
#else
int main(int argc, char **argv) {
#endif
    char *geometry = NULL;
    char *url = NULL;
#ifdef WEBVIEW_GTK
    // See https://wiki.archlinux.org/index.php/GTK#Disable_overlay_scrollbars
    setenv("GTK_OVERLAY_SCROLLING", "0", 1);
#endif
    for (int i = 1; i < argc; i++) {
        char *arg = argv[i];
        if (strcmp(arg, "--geometry") == 0 && i+1 < argc) {
            geometry = argv[++i];
        } else {
            url = arg;
        }
    }
    int width = 800, height = 600;
    if (geometry) {
        int w, h;
        if (sscanf(geometry, "%dx%d", &w, &h) == 2) {
            width = w;
            height = h;
        }
    }
    w.set_title("DomTerm");
#ifdef WEBVIEW_GTK
    char gtk_version_str[80];
    sprintf(gtk_version_str, "window.gtk_version = '%d.%d.%d';",
            gtk_get_major_version(), gtk_get_minor_version(), gtk_get_micro_version());
    webview_init(&w, gtk_version_str);
    gtk_window_set_decorated((GtkWindow*)(w.window()), 0);
#if 0
    webview_bind(&w, "_dt_toggleDeveloperTools", toggle_inspector, NULL);
#endif
#endif
    webview_bind(&w, "setWindowTitle", set_w_t, NULL);
    webview_bind(&w, "closeMainWindow", close_main_window, NULL);
    w.set_size(width, height, WEBVIEW_HINT_NONE);
    w.navigate(url);
    w.run();
    return 0;
}
