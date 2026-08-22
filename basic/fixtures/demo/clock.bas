CONST PI = 3.141593 'The mathematical value of PI to six places. You can also use QB64's native _PI.
DIM clock(60)             'A dimensioned array to hold 60 radian points
clockcount% = 15          'A counter to keep track of the radians

'* Start at radian 2*PI and continue clockwise to radian 0
'* Since radian 2*PI points directly right, we need to start clockcount%
'* at 15 (for 15 seconds).  The FOR/NEXT loop counts backwards in increments
'* of 60 giving us the 60 second clock points.  These points are then stored
'* in the dimensioned array clock() to be used later.
'*
FOR radian = 2 * PI TO 0 STEP -(2 * PI) / 60
    clock(clockcount%) = radian
    clockcount% = clockcount% + 1
    IF clockcount% = 61 THEN clockcount% = 1
NEXT radian
'* Change to a graphics screen and draw the clock face
SCREEN 7
CLS
LOCATE 1, 1
COLOR 14, 0
PRINT "Ritchie's Clock"
COLOR 9, 0
PRINT "Uses CIRCLE to"
PRINT "draw hands!"
COLOR 8, 0
CIRCLE (160, 100), 110, 8 'circle with radius of 110 and dark gray
CIRCLE (160, 100), 102, 8 'circle with radius of 102 and dark gray
PAINT (265, 100), 8, 8 'fill between the two dark gray circles with gray
CIRCLE (160, 100), 110, 7 'circle with radius of 110 and light gray
'*
'* Get the current time from the QuickBASIC built in variable TIME$
'* Since TIME$ is a string, we need to extract the hours, minutes and
'* seconds from it using LEFT$, RIGHT$ and MID$. Then, each of these
'* extractions need to be converted to a numeric value using VAL and
'* stored in their respective variables.
'*
seconds% = INT(VAL(RIGHT$(TIME$, 2))) 'extract seconds from TIME$
IF seconds% = 0 THEN seconds% = 60 'array counts 1 to 60 not 0 to 59
previoussecond% = seconds% 'hold current second for later use
minutes% = INT(VAL(MID$(TIME$, 4, 2))) 'extract minutes from TIME$
IF minutes% = 0 THEN minutes% = 60 'array counts 1 to 60 not 0 to 59
previousminute% = minutes% 'hold current minute for later use
hours% = INT(VAL(LEFT$(TIME$, 2))) 'extract hour from TIME$
IF hours% >= 12 THEN hours% = hours% - 12 'convert from military time
IF hours% = 0 THEN hours% = 12 'count from 1 to 12 not 0 to 11
previoushour% = hours% 'hold current hour for later use
'*
'* Start of main program loop
'*
DO
    IF seconds% <> previoussecond% THEN 'has a second elapsed?
        LOCATE 22, 17 'print the time on the screen at
        PRINT TIME$; 'position 22, 17
        '* Since a second has elapsed we need to erase the old second hand
        '* position and draw the new position
     
        CIRCLE (160, 100), 100, 0, -clock(previoussecond%), clock(previoussecond%)
        CIRCLE (160, 100), 100, 15, -clock(seconds%), clock(seconds%)
        previoussecond% = seconds% 'hold current second for later use
        IF minutes% <> previousminute% THEN 'has a minute elapsed?
            '* Since a minute has elapsed we need to erase the old hour hand position
            CIRCLE (160, 100), 90, 0, -clock(previousminute%), clock(previousminute%)
            previousminute% = minutes% 'hold current minute for later use
        END IF
        '*
        '* Draw the current minute hand position
        '*
        CIRCLE (160, 100), 90, 14, -clock(minutes%), clock(minutes%)
        IF hours% <> previoushour% THEN 'has an hour elapsed?
            '* Since an hour has elapsed we need to erase the old hour hand position        
            CIRCLE (160, 100), 75, 0, -clock(previoushour% * 5), clock(previoushour% * 5)
            previoushour% = hours% 'hold current hour for later use
        END IF
        '*
        '* Draw the current hour hand position
        '*
        CIRCLE (160, 100), 75, 12, -clock(hours% * 5), clock(hours% * 5)
    END IF
    seconds% = VAL(RIGHT$(TIME$, 2)) 'extract time again and do all over
    IF seconds% = 0 THEN seconds% = 60
    minutes% = VAL(MID$(TIME$, 4, 2))
    IF minutes% = 0 THEN minutes% = 60
    hours% = VAL(LEFT$(TIME$, 2))
    IF hours% >= 12 THEN hours% = hours% - 12
    IF hours% = 0 THEN hours% = 12
LOOP UNTIL INKEY$ <> "" 'stop program if user presses a key  
