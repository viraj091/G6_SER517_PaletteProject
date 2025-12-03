import sys
import json
import requests
from PySide6.QtCore import QUrl
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWidgets import QMainWindow, QApplication


class CanvasSession(requests.Session):
    """
    This class extends the requests.Sessions class to include a Canvas login at when the session is created.
    A QT web engine view provides the browser-based login.  Once login is complete, the security cookies are
    transferred to the Session object, after which it may be used just like a requests.Session object to access
    password-protected canvas artifacts.
    """
    class LoginWindow(QMainWindow):
        """
        This class defines a login browser using a QTWebEngineView.  When the constructor is called, the login process
        is initiated.  Once login is completed, the window automatically closes.  After closure, the object's cookies
        member data can be used to populate a sessions object for further secure communication.  This class is intended
        for internal use only by the CanvasSessions object.
        """

        def __init__(self, *args, **kwargs):
            super(CanvasSession.LoginWindow, self).__init__(*args, **kwargs)

            # create a QWebEngineView
            self.view = QWebEngineView()

            # set path to force canvas login
            self.view.setUrl(QUrl("http://canvas.asu.edu"))

            # hook to capture cookies
            self.cookies = {}
            self.view.page().profile().cookieStore().cookieAdded.connect(self.__add_cookie)
            self.view.page().profile().cookieStore().cookieRemoved.connect(self.__remove_cookie)
            self.view.loadProgress.connect(self.__page_loading)

            # place web view in window and show the window
            self.setCentralWidget(self.view)
            self.setWindowTitle("Canvas Login - Palette")
            self.resize(800, 600)

        def __page_loading(self, _ignored_progress):
            # if the secure canvas domain has been reached, the login is complete
            url = self.view.page().url().toString()
            if url.startswith('https://canvas.asu.edu'):
                # remove hooks for cookie store
                try:
                    self.view.page().profile().cookieStore().cookieAdded.disconnect(self.__add_cookie)
                    self.view.page().profile().cookieStore().cookieRemoved.disconnect(self.__remove_cookie)
                    self.view.loadProgress.disconnect(self.__page_loading)
                except:
                    pass  # Already disconnected

                # close the window - exiting the QT event loop
                self.close()

                # Force quit the application
                QApplication.quit()

        def __add_cookie(self, cookie):
            self.cookies[cookie.name().data().decode('utf-8')] = cookie.value().data().decode('utf-8')

        def __remove_cookie(self, cookie):
            del self.cookies[cookie.name().data().decode('utf-8')]

    def __init__(self):
        # create the session
        super(CanvasSession, self).__init__()

        # create a qt application
        app = QApplication(sys.argv)
        app.setApplicationName("Canvas Login - Palette")

        # create the login window
        window = CanvasSession.LoginWindow()
        window.show()

        # start the qt event loop and wait for login
        app.exec()

        # login is now complete - hijack the cookies into this session
        self.captured_cookies = {}
        for key in window.cookies.keys():
            self.cookies.set(key, window.cookies[key])
            self.captured_cookies[key] = window.cookies[key]


def main():
    """
    Main entry point for the Canvas login script.
    Initiates login and writes cookies to a temp file for backend consumption.
    """
    import tempfile
    import os

    # Get output file path from command line argument or use temp file
    if len(sys.argv) > 1:
        output_file = sys.argv[1]
    else:
        temp_dir = tempfile.gettempdir()
        output_file = os.path.join(temp_dir, 'palette_canvas_login.json')

    try:
        # create a session, initiating the login process
        session = CanvasSession()

        result = {
            "success": True,
            "cookies": session.captured_cookies
        }

        # Write to file
        with open(output_file, 'w') as f:
            json.dump(result, f)

        # Also print to stdout for backward compatibility
        print(json.dumps(result))

        return 0
    except Exception as e:
        # Write error to file
        error_data = {
            "success": False,
            "error": str(e)
        }

        try:
            with open(output_file, 'w') as f:
                json.dump(error_data, f)
        except:
            pass

        print(json.dumps(error_data), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
