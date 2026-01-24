{ pkgs }: {
  deps = [
    pkgs.python311
    pkgs.python311Packages.fastapi
    pkgs.python311Packages.uvicorn
    pkgs.python311Packages.python-telegram-bot
    pkgs.python311Packages.pydantic
    pkgs.python311Packages.flask
  ];
}
