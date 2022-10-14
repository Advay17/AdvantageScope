import { contentTracing } from "electron";
import { degreesToRadians, metersToInches, transformPx } from "../util";
import Visualizer from "./Visualizer";

export default class OdometryVisualizer implements Visualizer {
  private CONTAINER: HTMLElement;
  private CANVAS: HTMLCanvasElement;
  private IMAGE: HTMLImageElement;

  private lastImageSource = "";

  constructor(container: HTMLElement) {
    this.CONTAINER = container;
    this.CANVAS = container.firstElementChild as HTMLCanvasElement;
    this.IMAGE = document.createElement("img");
    this.CANVAS.appendChild(this.IMAGE);
  }

  render(command: any): number | null {
    // Set up canvas
    let context = this.CANVAS.getContext("2d") as CanvasRenderingContext2D;
    let isVertical =
      command.options.orientation == "blue bottom, red top" || command.options.orientation == "red bottom, blue top";
    let width = isVertical ? this.CONTAINER.clientHeight : this.CONTAINER.clientWidth;
    let height = isVertical ? this.CONTAINER.clientWidth : this.CONTAINER.clientHeight;
    this.CANVAS.style.width = width.toString() + "px";
    this.CANVAS.style.height = height.toString() + "px";
    this.CANVAS.width = width * window.devicePixelRatio;
    this.CANVAS.height = height * window.devicePixelRatio;
    context.scale(window.devicePixelRatio, window.devicePixelRatio);
    context.clearRect(0, 0, width, height);

    // Set canvas transform
    switch (command.options.orientation) {
      case "blue left, red right":
        this.CANVAS.style.transform = "translate(-50%, -50%)";
        break;
      case "red left, blue right":
        this.CANVAS.style.transform = "translate(-50%, -50%) rotate(180deg)";
        break;
      case "blue bottom, red top":
        this.CANVAS.style.transform = "translate(-50%, -50%) rotate(-90deg)";
        break;
      case "red bottom, blue top":
        this.CANVAS.style.transform = "translate(-50%, -50%) rotate(90deg)";
        break;
    }

    // Get game data and update image element
    let gameData = window.frcData?.field2ds.find((game) => game.title == command.options.game);
    if (!gameData) return null;
    if (gameData.path != this.lastImageSource) {
      this.lastImageSource = gameData.path;
      this.IMAGE.src = gameData.path;
    }
    if (!(this.IMAGE.width > 0 && this.IMAGE.height > 0)) {
      return null;
    }

    // Determine if robot is flipped
    let robotFlipped = command.options.alliance == "red";

    // Render background
    let fieldWidth = gameData.bottomRight[0] - gameData.topLeft[0];
    let fieldHeight = gameData.bottomRight[1] - gameData.topLeft[1];

    let topMargin = gameData.topLeft[1];
    let bottomMargin = this.IMAGE.height - gameData.bottomRight[1];
    let leftMargin = gameData.topLeft[0];
    let rightMargin = this.IMAGE.width - gameData.bottomRight[0];

    let margin = Math.min(topMargin, bottomMargin, leftMargin, rightMargin);
    let extendedFieldWidth = fieldWidth + margin * 2;
    let extendedFieldHeight = fieldHeight + margin * 2;
    let constrainHeight = width / height > extendedFieldWidth / extendedFieldHeight;
    let imageScalar = 1;
    if (constrainHeight) {
      imageScalar = height / extendedFieldHeight;
    } else {
      imageScalar = width / extendedFieldWidth;
    }
    let fieldCenterX = fieldWidth * 0.5 + gameData.topLeft[0];
    let fieldCenterY = fieldHeight * 0.5 + gameData.topLeft[1];
    let renderValues = [
      Math.floor(width * 0.5 - fieldCenterX * imageScalar), // X (normal)
      Math.floor(height * 0.5 - fieldCenterY * imageScalar), // Y (normal)
      Math.ceil(width * -0.5 - fieldCenterX * imageScalar), // X (flipped)
      Math.ceil(height * -0.5 - fieldCenterY * imageScalar), // Y (flipped)
      this.IMAGE.width * imageScalar, // Width
      this.IMAGE.height * imageScalar // Height
    ];
    context.drawImage(this.IMAGE, renderValues[0], renderValues[1], renderValues[4], renderValues[5]);

    // Calculate field edges
    let canvasFieldLeft = renderValues[0] + gameData.topLeft[0] * imageScalar;
    let canvasFieldTop = renderValues[1] + gameData.topLeft[1] * imageScalar;
    let canvasFieldWidth = fieldWidth * imageScalar;
    let canvasFieldHeight = fieldHeight * imageScalar;
    let pixelsPerInch = (canvasFieldHeight / gameData.heightInches + canvasFieldWidth / gameData.widthInches) / 2;

    // Convert pose data to pixel coordinates
    let calcCoordinates = (position: [number, number]): [number, number] => {
      if (!gameData) return [0, 0];

      let positionInches = [position[0], position[1]];
      if (command.options.unitDistance == "meters") {
        positionInches = [metersToInches(position[0]), metersToInches(position[1])];
      }

      positionInches[1] *= -1; // Positive y is flipped on the canvas
      switch (command.options.origin) {
        case "left":
          break;
        case "center":
          positionInches[1] += gameData.heightInches / 2;
          break;
        case "right":
          positionInches[1] += gameData.heightInches;
          break;
      }

      let positionPixels: [number, number] = [
        positionInches[0] * (canvasFieldWidth / gameData.widthInches),
        positionInches[1] * (canvasFieldHeight / gameData.heightInches)
      ];
      if (robotFlipped) {
        positionPixels[0] = canvasFieldLeft + canvasFieldWidth - positionPixels[0];
        positionPixels[1] = canvasFieldTop + canvasFieldHeight - positionPixels[1];
      } else {
        positionPixels[0] += canvasFieldLeft;
        positionPixels[1] += canvasFieldTop;
      }
      return positionPixels;
    };

    // Calculate robot length
    let robotLengthPixels =
      pixelsPerInch *
      (command.options.unitDistance == "inches" ? command.options.size : metersToInches(command.options.size));

    if (command.pose.robotPose.pose != null) {
      // Calculate robot position
      let robotPos = calcCoordinates(command.pose.robotPose.pose);
      let rotation =
        command.options.unitRotation == "radians"
          ? command.pose.robotPose.pose[2]
          : degreesToRadians(command.pose.robotPose.pose[2]);
      if (robotFlipped) rotation += Math.PI;

      // Render trail
      if (command.pose.robotPose.trail.filter((x: any) => x != null).length > 0) {
        let trailCoordinates: ([number, number] | null)[] = [];
        let maxDistance = 0;
        command.pose.robotPose.trail.forEach((position: [number, number] | null) => {
          if (position == null) {
            trailCoordinates.push(null);
          } else {
            let coordinates = calcCoordinates(position);
            trailCoordinates.push(coordinates);
            let distance = Math.hypot(coordinates[0] - robotPos[0], coordinates[1] - robotPos[0]);
            if (distance > maxDistance) maxDistance = distance;
          }
        });

        let gradient = context.createRadialGradient(
          robotPos[0],
          robotPos[1],
          robotLengthPixels * 0.5,
          robotPos[0],
          robotPos[1],
          maxDistance
        );
        gradient.addColorStop(0, "rgba(170, 170, 170, 1)");
        gradient.addColorStop(0.25, "rgba(170, 170, 170, 1)");
        gradient.addColorStop(1, "rgba(170, 170, 170, 0)");

        context.strokeStyle = gradient;
        context.lineWidth = 1 * pixelsPerInch;
        context.lineCap = "round";
        context.lineJoin = "round";
        context.beginPath();
        let firstPoint = true;
        trailCoordinates.forEach((position) => {
          if (position == null) {
            context.stroke();
            context.beginPath();
            firstPoint = true;
          } else {
            if (firstPoint) {
              context.moveTo(position[0], position[1]);
              firstPoint = false;
            } else {
              context.lineTo(position[0], position[1]);
            }
          }
        });
        context.stroke();
      }

      // Render vision line
      if (command.pose.visionCoordinates != null) {
        let visionCoordinates = calcCoordinates(command.pose.visionCoordinates);
        context.strokeStyle = "lightgreen";
        context.lineWidth = 1 * pixelsPerInch;
        context.beginPath();
        context.moveTo(robotPos[0], robotPos[1]);
        context.lineTo(visionCoordinates[0], visionCoordinates[1]);
        context.stroke();
      }

      // Render robot
      context.fillStyle = "#222";
      context.strokeStyle = command.options.alliance;
      context.lineWidth = 3 * pixelsPerInch;
      let backLeft = transformPx(robotPos, rotation, [robotLengthPixels * -0.5, robotLengthPixels * 0.5]);
      let frontLeft = transformPx(robotPos, rotation, [robotLengthPixels * 0.5, robotLengthPixels * 0.5]);
      let frontRight = transformPx(robotPos, rotation, [robotLengthPixels * 0.5, robotLengthPixels * -0.5]);
      let backRight = transformPx(robotPos, rotation, [robotLengthPixels * -0.5, robotLengthPixels * -0.5]);
      context.beginPath();
      context.moveTo(frontLeft[0], frontLeft[1]);
      context.lineTo(frontRight[0], frontRight[1]);
      context.lineTo(backRight[0], backRight[1]);
      context.lineTo(backLeft[0], backLeft[1]);
      context.closePath();
      context.fill();
      context.stroke();

      context.strokeStyle = "white";
      context.lineWidth = 1 * pixelsPerInch;
      let arrowBack = transformPx(robotPos, rotation, [robotLengthPixels * -0.3, 0]);
      let arrowFront = transformPx(robotPos, rotation, [robotLengthPixels * 0.3, 0]);
      let arrowLeft = transformPx(robotPos, rotation, [robotLengthPixels * 0.15, robotLengthPixels * 0.15]);
      let arrowRight = transformPx(robotPos, rotation, [robotLengthPixels * 0.15, robotLengthPixels * -0.15]);
      context.beginPath();
      context.moveTo(arrowBack[0], arrowBack[1]);
      context.lineTo(arrowFront[0], arrowFront[1]);
      context.moveTo(arrowLeft[0], arrowLeft[1]);
      context.lineTo(arrowFront[0], arrowFront[1]);
      context.lineTo(arrowRight[0], arrowRight[1]);
      context.stroke();
    }

    // Render ghost robot
    if (command.pose.ghostPose != null) {
      let robotPos = calcCoordinates(command.pose.ghostPose);
      let rotation =
        command.options.unitRotation == "radians"
          ? command.pose.ghostPose[2]
          : command.pose.ghostPose[2] * (Math.PI / 180);
      if (robotFlipped) rotation += Math.PI;

      context.globalAlpha = 0.5;
      context.fillStyle = "#222";
      context.strokeStyle = command.options.alliance;
      context.lineWidth = 3 * pixelsPerInch;
      let backLeft = transformPx(robotPos, rotation, [robotLengthPixels * -0.5, robotLengthPixels * 0.5]);
      let frontLeft = transformPx(robotPos, rotation, [robotLengthPixels * 0.5, robotLengthPixels * 0.5]);
      let frontRight = transformPx(robotPos, rotation, [robotLengthPixels * 0.5, robotLengthPixels * -0.5]);
      let backRight = transformPx(robotPos, rotation, [robotLengthPixels * -0.5, robotLengthPixels * -0.5]);
      context.beginPath();
      context.moveTo(frontLeft[0], frontLeft[1]);
      context.lineTo(frontRight[0], frontRight[1]);
      context.lineTo(backRight[0], backRight[1]);
      context.lineTo(backLeft[0], backLeft[1]);
      context.closePath();
      context.fill();
      context.stroke();

      context.strokeStyle = "white";
      context.lineWidth = 1 * pixelsPerInch;
      let arrowBack = transformPx(robotPos, rotation, [robotLengthPixels * -0.3, 0]);
      let arrowFront = transformPx(robotPos, rotation, [robotLengthPixels * 0.3, 0]);
      let arrowLeft = transformPx(robotPos, rotation, [robotLengthPixels * 0.15, robotLengthPixels * 0.15]);
      let arrowRight = transformPx(robotPos, rotation, [robotLengthPixels * 0.15, robotLengthPixels * -0.15]);
      context.beginPath();
      context.moveTo(arrowBack[0], arrowBack[1]);
      context.lineTo(arrowFront[0], arrowFront[1]);
      context.moveTo(arrowLeft[0], arrowLeft[1]);
      context.lineTo(arrowFront[0], arrowFront[1]);
      context.lineTo(arrowRight[0], arrowRight[1]);
      context.stroke();
    }

    // Return target aspect ratio
    return isVertical ? fieldHeight / fieldWidth : fieldWidth / fieldHeight;
  }
}
